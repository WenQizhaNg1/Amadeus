import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_VERSION,
  stageToAmadeusMessageSchema,
  type AmadeusToStageMessage,
} from '@amadeus/stage-protocol';

import type {
  StageTransportFailure,
  StageTransportObserver,
} from '../../src/transport/stage-transport.ts';
import {
  WebSocketStageTransport,
  stageWebSocketUrl,
  type StageClientSocket,
} from '../../src/transport/websocket-stage-transport.ts';

interface FakeSocketHandlers {
  open(): void;
  message(data: unknown): void;
  close(): void;
  error(): void;
}

class FakeSocket implements StageClientSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  #handlers?: FakeSocketHandlers;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 2;
    this.closes.push({ code, reason });
  }

  listen(handlers: FakeSocketHandlers): () => void {
    this.#handlers = handlers;
    return () => {
      if (this.#handlers === handlers) {
        this.#handlers = undefined;
      }
    };
  }

  open(): void {
    this.readyState = 1;
    this.#handlers?.open();
  }

  message(data: unknown): void {
    this.#handlers?.message(data);
  }

  serverClose(): void {
    this.readyState = 3;
    this.#handlers?.close();
  }
}

function observerFixture(): {
  observer: StageTransportObserver;
  statuses: string[];
  messages: AmadeusToStageMessage[];
  errors: StageTransportFailure[];
} {
  const statuses: string[] = [];
  const messages: AmadeusToStageMessage[] = [];
  const errors: StageTransportFailure[] = [];
  return {
    statuses,
    messages,
    errors,
    observer: {
      onConnectionChange: (status) => statuses.push(status),
      onMessage: (message) => messages.push(message),
      onError: (error) => errors.push(error),
    },
  };
}

describe('WebSocketStageTransport', () => {
  test('handshakes, validates the state snapshot and sends protocol messages', () => {
    const socket = new FakeSocket();
    const fixture = observerFixture();
    const transport = new WebSocketStageTransport({
      url: 'ws://localhost/ws',
      createSocket: () => socket,
    });
    const disconnect = transport.connect(fixture.observer);

    expect(fixture.statuses).toEqual(['connecting']);
    expect(() =>
      transport.send({ type: 'user.interrupt' }),
    ).toThrow('not ready');

    socket.open();
    expect(fixture.statuses).toEqual(['connecting', 'awaiting-state']);
    const ready = socket.sent[0];
    if (!ready) {
      throw new Error('Stage did not send its handshake.');
    }
    expect(stageToAmadeusMessageSchema.parse(JSON.parse(ready))).toEqual({
      type: 'stage.ready',
      protocolVersion: PROTOCOL_VERSION,
    });

    socket.message(
      JSON.stringify({
        type: 'stage.state',
        protocolVersion: PROTOCOL_VERSION,
        activity: 'idle',
      }),
    );
    transport.send({
      type: 'input.text',
      requestId: 'request-1',
      text: 'Hello.',
    });

    expect(fixture.messages).toHaveLength(1);
    const input = socket.sent[1];
    if (!input) {
      throw new Error('Stage did not send its input.');
    }
    expect(stageToAmadeusMessageSchema.parse(JSON.parse(input))).toEqual({
      type: 'input.text',
      requestId: 'request-1',
      text: 'Hello.',
    });

    disconnect();
    expect(socket.closes.at(-1)).toEqual({ code: 1000, reason: 'Stage closed' });
  });

  test('reports invalid server data and reconnects with bounded backoff', () => {
    const sockets: FakeSocket[] = [];
    const scheduled: Array<{ delay: number; run(): void; cancelled: boolean }> = [];
    const fixture = observerFixture();
    const transport = new WebSocketStageTransport({
      url: 'ws://localhost/ws',
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelay: 100,
      maxReconnectDelay: 1_000,
      random: () => 0.5,
      schedule: (callback, delay) => {
        const task = { delay, run: callback, cancelled: false };
        scheduled.push(task);
        return () => {
          task.cancelled = true;
        };
      },
    });
    const disconnect = transport.connect(fixture.observer);
    const first = sockets[0];
    if (!first) {
      throw new Error('Stage did not create its first socket.');
    }
    first.open();
    first.message('{');

    expect(fixture.errors).toEqual([
      {
        code: 'protocol.invalid_message',
        message: 'Core sent invalid JSON.',
        recoverable: true,
      },
    ]);
    expect(first.closes).toEqual([
      { code: 1002, reason: 'protocol.invalid_message' },
    ]);

    first.serverClose();
    expect(fixture.statuses.slice(-2)).toEqual([
      'disconnected',
      'reconnecting',
    ]);
    expect(scheduled[0]?.delay).toBe(100);
    scheduled[0]?.run();
    expect(sockets).toHaveLength(2);
    const second = sockets[1];
    if (!second) {
      throw new Error('Stage did not create its replacement socket.');
    }
    second.open();
    expect(second.sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'stage.ready', protocolVersion: PROTOCOL_VERSION },
    ]);

    disconnect();
  });

  test('does not reconnect after an unsupported protocol version', () => {
    const socket = new FakeSocket();
    const scheduled: number[] = [];
    const fixture = observerFixture();
    const transport = new WebSocketStageTransport({
      url: 'ws://localhost/ws',
      createSocket: () => socket,
      schedule: (_callback, delay) => {
        scheduled.push(delay);
        return () => {};
      },
    });
    transport.connect(fixture.observer);
    socket.open();
    socket.message(
      JSON.stringify({
        type: 'error',
        code: 'protocol.unsupported_version',
        message: 'Unsupported version.',
        recoverable: false,
      }),
    );
    socket.serverClose();

    expect(fixture.messages).toEqual([
      {
        type: 'error',
        code: 'protocol.unsupported_version',
        message: 'Unsupported version.',
        recoverable: false,
      },
    ]);
    expect(scheduled).toEqual([]);
  });

  test('builds a same-origin WebSocket URL', () => {
    expect(
      stageWebSocketUrl({ protocol: 'https:', host: 'localhost:8443' }),
    ).toBe('wss://localhost:8443/ws');
  });
});
