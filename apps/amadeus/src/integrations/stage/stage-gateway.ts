import {
  PROTOCOL_VERSION,
  amadeusToStageMessageSchema,
  stageToAmadeusMessageSchema,
  type AmadeusToStageMessage,
  type StageActivity,
  type StageProtocolErrorCode,
} from '@amadeus/stage-protocol';

import type { StageLink } from './stage-link.ts';

export interface StageSocket {
  sendText(message: string): void | Promise<void>;
  sendBinary(frame: Uint8Array): void | Promise<void>;
  close(code: number, reason: string): void;
}

export interface StageGatewayOptions {
  getActivity(): StageActivity;
  onInput(text: string): void | Promise<void>;
  onInterrupt(): void | Promise<void>;
  onDisconnect?(): void;
  onPlaybackFinished?(streamId: string): void;
}

export class StageDisconnectedError extends Error {
  constructor() {
    super('Stage is not connected.');
    this.name = 'StageDisconnectedError';
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.trim() || 'Unknown runtime error.').slice(0, 4_096);
}

function unsupportedVersion(value: unknown): number | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    value.type !== 'stage.ready' ||
    !('protocolVersion' in value) ||
    typeof value.protocolVersion !== 'number' ||
    value.protocolVersion === PROTOCOL_VERSION
  ) {
    return undefined;
  }
  return value.protocolVersion;
}

export class StageGateway implements StageLink {
  readonly #options: StageGatewayOptions;

  #socket?: StageSocket;
  #ready = false;

  constructor(options: StageGatewayOptions) {
    this.#options = options;
  }

  connect(socket: StageSocket): void {
    if (this.#socket && this.#socket !== socket) {
      this.#options.onDisconnect?.();
      this.#socket.close(1012, 'Stage connection replaced');
    }
    this.#socket = socket;
    this.#ready = false;
  }

  disconnect(socket: StageSocket): void {
    if (this.#socket !== socket) {
      return;
    }
    this.#socket = undefined;
    this.#ready = false;
    this.#options.onDisconnect?.();
  }

  async receive(socket: StageSocket, data: string | Uint8Array): Promise<void> {
    if (this.#socket !== socket) {
      socket.close(1008, 'Inactive Stage connection');
      return;
    }

    if (typeof data !== 'string') {
      await this.#sendError(
        socket,
        'protocol.invalid_state',
        'Binary audio is not available in the current Stage state.',
        true,
      );
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      await this.#sendError(
        socket,
        'protocol.invalid_message',
        'Stage sent invalid JSON.',
        true,
      );
      return;
    }

    const version = unsupportedVersion(decoded);
    if (version !== undefined) {
      try {
        await this.#sendError(
          socket,
          'protocol.unsupported_version',
          `Unsupported Stage protocol version ${version}.`,
          false,
        );
      } finally {
        socket.close(1002, 'Unsupported protocol version');
      }
      return;
    }

    const result = stageToAmadeusMessageSchema.safeParse(decoded);
    if (!result.success) {
      await this.#sendError(
        socket,
        'protocol.invalid_message',
        'Stage sent a message that does not match the protocol.',
        true,
      );
      return;
    }

    const message = result.data;
    if (!this.#ready) {
      if (message.type !== 'stage.ready') {
        await this.#sendError(
          socket,
          'protocol.invalid_state',
          'Stage must complete the protocol handshake first.',
          true,
        );
        return;
      }
      await this.#sendTo(socket, {
        type: 'stage.state',
        protocolVersion: PROTOCOL_VERSION,
        activity: this.#options.getActivity(),
      });
      if (this.#socket === socket) {
        this.#ready = true;
      }
      return;
    }

    switch (message.type) {
      case 'stage.ready':
        await this.#sendError(
          socket,
          'protocol.invalid_state',
          'Stage handshake is already complete.',
          true,
        );
        break;
      case 'input.text':
        await this.#acceptInput(socket, message.requestId, message.text);
        break;
      case 'user.interrupt':
        await this.#startOperation(socket, () => this.#options.onInterrupt());
        break;
      case 'speaker.played':
        if (this.#options.onPlaybackFinished) {
          await this.#startOperation(socket, () =>
            this.#options.onPlaybackFinished?.(message.streamId),
          );
        } else {
          await this.#sendError(
            socket,
            'protocol.invalid_state',
            'Speaker playback is not active.',
            true,
          );
        }
        break;
      case 'mic.start':
      case 'mic.stop':
        await this.#sendError(
          socket,
          'protocol.invalid_state',
          'Microphone input is not available yet.',
          true,
        );
        break;
    }
  }

  async send(message: AmadeusToStageMessage): Promise<void> {
    const socket = this.#socket;
    if (!socket || !this.#ready) {
      throw new StageDisconnectedError();
    }
    await this.#sendTo(socket, message);
  }

  async sendAudio(frame: Uint8Array): Promise<void> {
    const socket = this.#socket;
    if (!socket || !this.#ready) {
      throw new StageDisconnectedError();
    }
    await socket.sendBinary(frame);
  }

  notifyActivity(activity: StageActivity): Promise<void> {
    return this.send({ type: 'activity', activity });
  }

  async #acceptInput(
    socket: StageSocket,
    requestId: string,
    text: string,
  ): Promise<void> {
    let operation: void | Promise<void>;
    try {
      operation = this.#options.onInput(text);
    } catch (error) {
      await this.#sendError(
        socket,
        'runtime.input_rejected',
        errorMessage(error),
        true,
        requestId,
      );
      return;
    }

    this.#observe(socket, operation, requestId);
    await this.#sendTo(socket, { type: 'input.accepted', requestId });
  }

  #observe(
    source: StageSocket,
    operation: void | Promise<void>,
    requestId?: string,
  ): void {
    void Promise.resolve(operation).catch(async (error: unknown) => {
      const socket = this.#socket;
      if (socket !== source || !this.#ready) {
        return;
      }
      try {
        await this.#sendError(
          socket,
          'runtime.failed',
          errorMessage(error),
          true,
          requestId,
        );
      } catch {
        // The connection failure is reported by the socket lifecycle.
      }
    });
  }

  async #startOperation(
    socket: StageSocket,
    operation: () => void | Promise<void>,
  ): Promise<void> {
    try {
      this.#observe(socket, operation());
    } catch (error) {
      await this.#sendError(
        socket,
        'runtime.failed',
        errorMessage(error),
        true,
      );
    }
  }

  async #sendError(
    socket: StageSocket,
    code: StageProtocolErrorCode,
    message: string,
    recoverable: boolean,
    requestId?: string,
  ): Promise<void> {
    await this.#sendTo(socket, {
      type: 'error',
      code,
      message,
      recoverable,
      ...(requestId ? { requestId } : {}),
    });
  }

  async #sendTo(
    socket: StageSocket,
    message: AmadeusToStageMessage,
  ): Promise<void> {
    const parsed = amadeusToStageMessageSchema.parse(message);
    await socket.sendText(JSON.stringify(parsed));
  }
}
