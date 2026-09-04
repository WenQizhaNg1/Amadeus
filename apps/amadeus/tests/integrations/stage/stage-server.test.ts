import { describe, expect, test } from 'bun:test';

import {
  BufferedStageSocket,
  type ServerWebSocketPort,
} from '../../../src/integrations/stage/stage-server.ts';

class FakeServerSocket implements ServerWebSocketPort {
  status = 1;
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  sendText(): number {
    return this.status;
  }

  sendBinary(): number {
    return this.status;
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}

describe('BufferedStageSocket', () => {
  test('waits for drain when Bun reports backpressure', async () => {
    const port = new FakeServerSocket();
    port.status = -1;
    const socket = new BufferedStageSocket(port);
    const pending = socket.sendText('message');
    if (!pending) {
      throw new Error('Expected a pending backpressure promise.');
    }

    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBeFalse();

    socket.drain();
    await pending;
    expect(completed).toBeTrue();
  });

  test('reports dropped messages and rejects pending sends on close', async () => {
    const port = new FakeServerSocket();
    const socket = new BufferedStageSocket(port);
    port.status = 0;
    expect(() => socket.sendText('message')).toThrow('dropped');

    port.status = -1;
    const pending = socket.sendBinary(new Uint8Array([1]));
    if (!pending) {
      throw new Error('Expected a pending backpressure promise.');
    }
    socket.closed();
    await expect(pending).rejects.toThrow('closed during backpressure');
  });
});
