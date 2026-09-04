import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_VERSION,
  amadeusToStageMessageSchema,
  type AmadeusToStageMessage,
} from '@amadeus/stage-protocol';

import {
  StageDisconnectedError,
  StageGateway,
  type StageGatewayOptions,
  type StageSocket,
} from '../../../src/integrations/stage/stage-gateway.ts';

class FakeSocket implements StageSocket {
  readonly text: string[] = [];
  readonly binary: Uint8Array[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  sendText(message: string): void {
    this.text.push(message);
  }

  sendBinary(frame: Uint8Array): void {
    this.binary.push(frame);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  messages(): AmadeusToStageMessage[] {
    return this.text.map((value) =>
      amadeusToStageMessageSchema.parse(JSON.parse(value)),
    );
  }
}

function createGateway(
  options: Partial<StageGatewayOptions> = {},
): StageGateway {
  return new StageGateway({
    getActivity: () => 'idle',
    onInput: () => {},
    onInterrupt: () => {},
    ...options,
  });
}

async function handshake(
  gateway: StageGateway,
  socket: FakeSocket,
): Promise<void> {
  gateway.connect(socket);
  await gateway.receive(
    socket,
    JSON.stringify({
      type: 'stage.ready',
      protocolVersion: PROTOCOL_VERSION,
    }),
  );
}

async function waitForMessages(
  socket: FakeSocket,
  count: number,
): Promise<AmadeusToStageMessage[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const messages = socket.messages();
    if (messages.length >= count) {
      return messages;
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
  }
  throw new Error(`Timed out waiting for ${count} Stage messages.`);
}

describe('StageGateway', () => {
  test('requires a handshake and returns the current activity snapshot', async () => {
    let inputs = 0;
    const gateway = createGateway({
      getActivity: () => 'thinking',
      onInput: () => {
        inputs += 1;
      },
    });
    const socket = new FakeSocket();
    gateway.connect(socket);

    await gateway.receive(
      socket,
      JSON.stringify({
        type: 'input.text',
        requestId: 'request-1',
        text: 'Hello.',
      }),
    );
    expect(inputs).toBe(0);
    expect(socket.messages()[0]).toMatchObject({
      type: 'error',
      code: 'protocol.invalid_state',
    });

    socket.text.length = 0;
    await gateway.receive(
      socket,
      JSON.stringify({
        type: 'stage.ready',
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(socket.messages()).toEqual([
      {
        type: 'stage.state',
        protocolVersion: PROTOCOL_VERSION,
        activity: 'thinking',
      },
    ]);
  });

  test('acknowledges input once and reports a correlated runtime failure', async () => {
    let rejectInput: ((error: Error) => void) | undefined;
    let inputs = 0;
    const operation = new Promise<void>((_resolve, reject) => {
      rejectInput = reject;
    });
    const gateway = createGateway({
      onInput: () => {
        inputs += 1;
        return operation;
      },
    });
    const socket = new FakeSocket();
    await handshake(gateway, socket);
    socket.text.length = 0;

    await gateway.receive(
      socket,
      JSON.stringify({
        type: 'input.text',
        requestId: 'request-1',
        text: 'Hello.',
      }),
    );
    expect(inputs).toBe(1);
    expect(socket.messages()).toEqual([
      { type: 'input.accepted', requestId: 'request-1' },
    ]);

    if (!rejectInput) {
      throw new Error('Input operation was not initialized.');
    }
    rejectInput(new Error('Model failed.'));
    const messages = await waitForMessages(socket, 2);
    expect(messages[1]).toEqual({
      type: 'error',
      code: 'runtime.failed',
      message: 'Model failed.',
      recoverable: true,
      requestId: 'request-1',
    });
  });

  test('rejects malformed messages and closes unsupported versions', async () => {
    const gateway = createGateway();
    const socket = new FakeSocket();
    gateway.connect(socket);

    await gateway.receive(socket, '{');
    await gateway.receive(
      socket,
      JSON.stringify({ type: 'stage.ready', protocolVersion: 2 }),
    );

    expect(socket.messages().map((message) => message.type)).toEqual([
      'error',
      'error',
    ]);
    expect(socket.messages()[0]).toMatchObject({
      code: 'protocol.invalid_message',
    });
    expect(socket.messages()[1]).toMatchObject({
      code: 'protocol.unsupported_version',
      recoverable: false,
    });
    expect(socket.closes).toEqual([
      { code: 1002, reason: 'Unsupported protocol version' },
    ]);
  });

  test('routes interruption and rejects unavailable audio states', async () => {
    let interruptions = 0;
    const gateway = createGateway({
      onInterrupt: () => {
        interruptions += 1;
      },
    });
    const socket = new FakeSocket();
    await handshake(gateway, socket);
    socket.text.length = 0;

    await gateway.receive(socket, JSON.stringify({ type: 'user.interrupt' }));
    await gateway.receive(socket, new Uint8Array([1, 2]));
    await gateway.receive(
      socket,
      JSON.stringify({
        type: 'mic.stop',
        streamId: 'microphone-1',
      }),
    );

    expect(interruptions).toBe(1);
    expect(socket.messages()).toEqual([
      {
        type: 'error',
        code: 'protocol.invalid_state',
        message: 'Binary audio is not available in the current Stage state.',
        recoverable: true,
      },
      {
        type: 'error',
        code: 'protocol.invalid_state',
        message: 'Microphone input is not available yet.',
        recoverable: true,
      },
    ]);
  });

  test('converts a synchronous interruption failure to a protocol error', async () => {
    const gateway = createGateway({
      onInterrupt: () => {
        throw new Error('Interrupt failed.');
      },
    });
    const socket = new FakeSocket();
    await handshake(gateway, socket);
    socket.text.length = 0;

    await gateway.receive(socket, JSON.stringify({ type: 'user.interrupt' }));

    expect(socket.messages()).toEqual([
      {
        type: 'error',
        code: 'runtime.failed',
        message: 'Interrupt failed.',
        recoverable: true,
      },
    ]);
  });

  test('sends activity and disconnects a replaced client', async () => {
    let disconnects = 0;
    const gateway = createGateway({
      onDisconnect: () => {
        disconnects += 1;
      },
    });
    const first = new FakeSocket();
    await handshake(gateway, first);

    await gateway.notifyActivity('speaking');
    expect(first.messages().at(-1)).toEqual({
      type: 'activity',
      activity: 'speaking',
    });

    const second = new FakeSocket();
    gateway.connect(second);
    expect(first.closes).toEqual([
      { code: 1012, reason: 'Stage connection replaced' },
    ]);
    expect(disconnects).toBe(1);
    await expect(gateway.notifyActivity('idle')).rejects.toBeInstanceOf(
      StageDisconnectedError,
    );
  });
});
