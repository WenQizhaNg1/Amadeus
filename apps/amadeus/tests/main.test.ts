import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { closeResources, installShutdown } from '../src/main.ts';

describe('process lifecycle', () => {
  test('closes the application before its provider', async () => {
    const order: string[] = [];
    await closeResources(
      { async close() { order.push('app'); } },
      { async close() { order.push('provider'); } },
    );
    expect(order).toEqual(['app', 'provider']);
  });

  test('still closes the provider when application shutdown fails', async () => {
    const order: string[] = [];
    const error = new Error('app failed to close');
    await expect(
      closeResources(
        {
          async close() {
            order.push('app');
            throw error;
          },
        },
        { async close() { order.push('provider'); } },
      ),
    ).rejects.toBe(error);
    expect(order).toEqual(['app', 'provider']);
  });

  test('installs removable handlers for both shutdown signals', async () => {
    const source = new EventEmitter();
    let calls = 0;
    const remove = installShutdown(async () => {
      calls += 1;
    }, source);

    source.emit('SIGINT');
    await Promise.resolve();
    expect(calls).toBe(1);

    remove();
    source.emit('SIGTERM');
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
