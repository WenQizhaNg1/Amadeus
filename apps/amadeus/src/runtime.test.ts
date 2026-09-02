import { describe, expect, test } from 'bun:test';
import type {
  AgentInputItem,
  Runner,
  Session,
  SessionInputCallback,
} from '@openai/agents';

import type { AmadeusAgent } from './agent.ts';
import { AmadeusRuntime } from './amadeus.ts';
import type { AmadeusContext } from './context.ts';
import type { Voice } from './voice/voice.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function session(): Session {
  return {
    async getSessionId() {
      return 'test';
    },
    async getItems() {
      return [];
    },
    async addItems() {},
    async popItem() {
      return undefined;
    },
    async clearSession() {},
  };
}

const voice: Voice = {
  say() {
    throw new Error('Voice should not run in this test.');
  },
  interrupt() {},
};

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for condition.');
}

describe('AmadeusRuntime lifecycle', () => {
  test('forwards the session input callback to the SDK runner', async () => {
    const callback: SessionInputCallback = (history, input) => [
      ...history,
      ...input,
    ];
    let received: SessionInputCallback | undefined;
    const runner = {
      run(_agent: AmadeusAgent, _input: string | AgentInputItem[], options: any) {
        received = options.sessionInputCallback;
        return { completed: Promise.resolve(), error: null };
      },
    } as unknown as Runner;
    const runtime = new AmadeusRuntime({
      runner,
      agent: {} as AmadeusAgent,
      context: { voice } satisfies AmadeusContext,
      session: session(),
      sessionInputCallback: callback,
    });

    await runtime.turn('hello');
    expect(received).toBe(callback);
  });

  test('interrupt resolves only after the active handoff settles', async () => {
    const completion = deferred<void>();
    let started = false;
    const runner = {
      run() {
        started = true;
        return { completed: completion.promise, error: null };
      },
    } as unknown as Runner;
    const runtime = new AmadeusRuntime({
      runner,
      agent: {} as AmadeusAgent,
      context: { voice },
      session: session(),
    });

    const turn = runtime.turn('hello');
    await waitFor(() => started);
    let interrupted = false;
    const interruption = runtime.interrupt().then(() => {
      interrupted = true;
    });
    await Promise.resolve();
    expect(interrupted).toBe(false);

    completion.resolve();
    await Promise.all([turn, interruption]);
    expect(interrupted).toBe(true);
    expect(runtime.activity).toBe('idle');
  });
});
