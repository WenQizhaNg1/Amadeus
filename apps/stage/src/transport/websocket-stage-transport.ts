import {
  PROTOCOL_VERSION,
  amadeusToStageMessageSchema,
  stageToAmadeusMessageSchema,
  type AmadeusToStageMessage,
  type StageToAmadeusMessage,
} from '@amadeus/stage-protocol';

import type {
  StageTransport,
  StageTransportFailure,
  StageTransportObserver,
} from './stage-transport.ts';

interface SocketHandlers {
  open(): void;
  message(data: unknown): void;
  close(): void;
  error(): void;
}

export interface StageClientSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  listen(handlers: SocketHandlers): () => void;
}

type SocketFactory = (url: string) => StageClientSocket;
type Schedule = (callback: () => void, delay: number) => () => void;
const OPEN = 1;

export interface WebSocketStageTransportOptions {
  url?: string;
  createSocket?: SocketFactory;
  schedule?: Schedule;
  random?: () => number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

class BrowserStageSocket implements StageClientSocket {
  readonly #socket: WebSocket;

  constructor(url: string) {
    this.#socket = new WebSocket(url);
    this.#socket.binaryType = 'arraybuffer';
  }

  get readyState(): number {
    return this.#socket.readyState;
  }

  send(data: string): void {
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  listen(handlers: SocketHandlers): () => void {
    const onOpen = () => handlers.open();
    const onMessage = (event: MessageEvent<unknown>) => {
      handlers.message(event.data);
    };
    const onClose = () => handlers.close();
    const onError = () => handlers.error();

    this.#socket.addEventListener('open', onOpen);
    this.#socket.addEventListener('message', onMessage);
    this.#socket.addEventListener('close', onClose);
    this.#socket.addEventListener('error', onError);

    return () => {
      this.#socket.removeEventListener('open', onOpen);
      this.#socket.removeEventListener('message', onMessage);
      this.#socket.removeEventListener('close', onClose);
      this.#socket.removeEventListener('error', onError);
    };
  }
}

function defaultSchedule(callback: () => void, delay: number): () => void {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
}

export function stageWebSocketUrl(
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function parseMessage(data: unknown):
  | { message: AmadeusToStageMessage }
  | { error: StageTransportFailure } {
  if (typeof data !== 'string') {
    return {
      error: {
        code: 'protocol.invalid_message',
        message: 'Core sent an unexpected binary frame.',
        recoverable: true,
      },
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(data);
  } catch {
    return {
      error: {
        code: 'protocol.invalid_message',
        message: 'Core sent invalid JSON.',
        recoverable: true,
      },
    };
  }

  if (
    typeof decoded === 'object' &&
    decoded !== null &&
    'type' in decoded &&
    decoded.type === 'stage.state' &&
    'protocolVersion' in decoded &&
    typeof decoded.protocolVersion === 'number' &&
    decoded.protocolVersion !== PROTOCOL_VERSION
  ) {
    return {
      error: {
        code: 'protocol.unsupported_version',
        message: `Core uses unsupported protocol version ${decoded.protocolVersion}.`,
        recoverable: false,
      },
    };
  }

  const result = amadeusToStageMessageSchema.safeParse(decoded);
  if (!result.success) {
    return {
      error: {
        code: 'protocol.invalid_message',
        message: 'Core sent a message that does not match the Stage protocol.',
        recoverable: true,
      },
    };
  }
  return { message: result.data };
}

export class WebSocketStageTransport implements StageTransport {
  readonly label = 'WebSocket /ws';

  readonly #url: string;
  readonly #createSocket: SocketFactory;
  readonly #schedule: Schedule;
  readonly #random: () => number;
  readonly #reconnectDelay: number;
  readonly #maxReconnectDelay: number;

  #observer?: StageTransportObserver;
  #socket?: StageClientSocket;
  #stopListening?: () => void;
  #cancelReconnect?: () => void;
  #attempt = 0;
  #ready = false;
  #reconnect = true;

  constructor(options: WebSocketStageTransportOptions = {}) {
    this.#url = options.url ?? stageWebSocketUrl();
    this.#createSocket =
      options.createSocket ?? ((url) => new BrowserStageSocket(url));
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#random = options.random ?? Math.random;
    this.#reconnectDelay = options.reconnectDelay ?? 500;
    this.#maxReconnectDelay = options.maxReconnectDelay ?? 10_000;
  }

  connect(observer: StageTransportObserver): () => void {
    if (this.#observer) {
      throw new Error('Stage transport is already connected.');
    }

    this.#observer = observer;
    this.#attempt = 0;
    this.#ready = false;
    this.#reconnect = true;
    this.#open(false);

    return () => {
      this.#reconnect = false;
      this.#cancelReconnect?.();
      this.#cancelReconnect = undefined;
      this.#stopListening?.();
      this.#stopListening = undefined;
      this.#socket?.close(1000, 'Stage closed');
      this.#socket = undefined;
      this.#observer = undefined;
      this.#ready = false;
    };
  }

  send(message: StageToAmadeusMessage): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN || !this.#ready) {
      throw new Error('Stage WebSocket is not ready.');
    }
    socket.send(JSON.stringify(stageToAmadeusMessageSchema.parse(message)));
  }

  #open(reconnecting: boolean): void {
    this.#observer?.onConnectionChange(
      reconnecting ? 'reconnecting' : 'connecting',
    );

    let socket: StageClientSocket;
    try {
      socket = this.#createSocket(this.#url);
    } catch (error) {
      this.#report({
        code: 'stage.transport_failed',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      this.#scheduleReconnect();
      return;
    }

    this.#socket = socket;
    this.#stopListening = socket.listen({
      open: () => this.#opened(socket),
      message: (data) => this.#received(socket, data),
      close: () => this.#closed(socket),
      error: () => {
        if (this.#socket === socket) {
          this.#report({
            code: 'stage.transport_failed',
            message: 'Stage WebSocket connection failed.',
            recoverable: true,
          });
        }
      },
    });
  }

  #opened(socket: StageClientSocket): void {
    if (this.#socket !== socket) {
      return;
    }
    try {
      socket.send(
        JSON.stringify({
          type: 'stage.ready',
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
      this.#observer?.onConnectionChange('awaiting-state');
    } catch (error) {
      this.#report({
        code: 'stage.transport_failed',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      socket.close(1011, 'Handshake failed');
    }
  }

  #received(socket: StageClientSocket, data: unknown): void {
    if (this.#socket !== socket) {
      return;
    }

    const result = parseMessage(data);
    if ('error' in result) {
      this.#report(result.error);
      if (!result.error.recoverable) {
        this.#reconnect = false;
      }
      socket.close(1002, result.error.code);
      return;
    }

    if (result.message.type === 'stage.state') {
      this.#ready = true;
      this.#attempt = 0;
    } else if (result.message.type === 'error') {
      if (result.message.code === 'protocol.unsupported_version') {
        this.#reconnect = false;
      }
      this.#observer?.onMessage(result.message);
      return;
    } else if (!this.#ready) {
      this.#report({
        code: 'protocol.invalid_message',
        message: 'Core sent data before the state snapshot.',
        recoverable: true,
      });
      socket.close(1002, 'Missing state snapshot');
      return;
    }

    this.#observer?.onMessage(result.message);
  }

  #closed(socket: StageClientSocket): void {
    if (this.#socket !== socket) {
      return;
    }
    this.#stopListening?.();
    this.#stopListening = undefined;
    this.#socket = undefined;
    this.#ready = false;
    this.#observer?.onConnectionChange('disconnected');
    if (this.#reconnect) {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (!this.#observer || !this.#reconnect || this.#cancelReconnect) {
      return;
    }
    this.#observer.onConnectionChange('reconnecting');
    const base = Math.min(
      this.#maxReconnectDelay,
      this.#reconnectDelay * 2 ** this.#attempt,
    );
    const delay = Math.round(base * (0.8 + this.#random() * 0.4));
    this.#attempt += 1;
    this.#cancelReconnect = this.#schedule(() => {
      this.#cancelReconnect = undefined;
      this.#open(true);
    }, delay);
  }

  #report(error: StageTransportFailure): void {
    this.#observer?.onError(error);
  }
}
