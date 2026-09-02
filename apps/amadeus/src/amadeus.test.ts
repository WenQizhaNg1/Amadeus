import { describe, expect, test } from 'bun:test';
import type {
  AgentInputItem,
  Runner,
  Session,
  StreamRunOptions,
} from '@openai/agents';

import type { AmadeusAgent } from './agent.ts';
import { AmadeusRuntime } from './amadeus.ts';
import type { Activity } from './activity.ts';
import type { AmadeusContext } from './context.ts';
import type { Voice } from './voice/voice.ts';
import type { Utterance, UtteranceResult } from './voice/utterance.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeVoice implements Voice {
  interruptCount = 0;
  sayText?: string;
  nextUtterance?: Deferred<UtteranceResult>;

  say(text: string): Utterance {
    this.sayText = text;
    const done = this.nextUtterance ?? deferred<UtteranceResult>();
    this.nextUtterance = done;
    return {
      id: 'utterance-1',
      done: done.promise,
      interrupt: () => done.resolve({ status: 'interrupted' }),
    };
  }

  interrupt(): void {
    this.interruptCount += 1;
    this.nextUtterance?.resolve({ status: 'interrupted' });
  }
}

interface RunCall {
  input: string | AgentInputItem[];
  options: StreamRunOptions<AmadeusContext, AmadeusAgent>;
}

interface FakeRunResult {
  completed: Promise<void>;
  error?: unknown;
}

function fakeRunner(
  run: (call: RunCall) => FakeRunResult | Promise<FakeRunResult>,
): Runner {
  return {
    async run(
      _agent: AmadeusAgent,
      input: string | AgentInputItem[],
      options: StreamRunOptions<AmadeusContext, AmadeusAgent>,
    ) {
      return await run({ input, options });
    },
  } as unknown as Runner;
}

function fakeSession(): Session {
  return {
    async getSessionId() {
      return 'test-session';
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

function fixture(runner: Runner): {
  runtime: AmadeusRuntime;
  voice: FakeVoice;
  activities: Activity[];
  session: Session;
} {
  const voice = new FakeVoice();
  const activities: Activity[] = [];
  const session = fakeSession();
  const context: AmadeusContext = {
    voice,
    memory: {
      async recall() {
        return [];
      },
      async remember(item) {
        return { ...item, id: 'memory-1', createdAt: 0 };
      },
      async forget() {},
    },
  };

  return {
    runtime: new AmadeusRuntime({
      runner,
      context,
      session,
      onActivity: (activity) => {
        activities.push(activity);
      },
    }),
    voice,
    activities,
    session,
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition.');
}

describe('AmadeusRuntime', () => {
  test('runs a user turn with context, session, streaming and activity', async () => {
    const calls: RunCall[] = [];
    const completion = deferred<void>();
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        return { completed: completion.promise, error: null };
      }),
    );

    const turn = setup.runtime.turn(' Hello. ');
    await waitFor(() => calls.length === 1);

    expect(calls[0]?.input).toBe('Hello.');
    expect(calls[0]?.options.session).toBe(setup.session);
    expect(calls[0]?.options.stream).toBe(true);
    expect(setup.runtime.activity).toBe('thinking');

    completion.resolve();
    await turn;

    expect(setup.runtime.activity).toBe('idle');
    expect(setup.activities).toEqual(['thinking', 'idle']);
  });

  test('a new user turn aborts the old turn before it starts', async () => {
    const calls: RunCall[] = [];
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        return { completed: Promise.resolve() };
      }),
    );

    const first = setup.runtime.turn('first');
    const second = setup.runtime.turn('second');
    await Promise.all([first, second]);

    expect(calls.map((call) => call.input)).toEqual(['second']);
  });

  test('a new user turn interrupts active voice and waits for the old run', async () => {
    const calls: RunCall[] = [];
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        if (calls.length > 1) {
          return { completed: Promise.resolve() };
        }

        const completed = new Promise<void>((_resolve, reject) => {
          call.options.signal?.addEventListener(
            'abort',
            () => reject(call.options.signal?.reason),
            { once: true },
          );
        });
        return { completed };
      }),
    );

    const first = setup.runtime.turn('first');
    await waitFor(() => calls.length === 1);
    const second = setup.runtime.turn('second');
    await Promise.all([first, second]);

    expect(calls[0]?.options.signal?.aborted).toBe(true);
    expect(calls.map((call) => call.input)).toEqual(['first', 'second']);
    expect(setup.voice.interruptCount).toBe(1);
  });

  test('explicit interruption settles the runtime back to idle', async () => {
    let call: RunCall | undefined;
    const setup = fixture(
      fakeRunner((currentCall) => {
        call = currentCall;
        const completed = new Promise<void>((_resolve, reject) => {
          currentCall.options.signal?.addEventListener(
            'abort',
            () => reject(currentCall.options.signal?.reason),
            { once: true },
          );
        });
        return { completed };
      }),
    );

    const turn = setup.runtime.turn('hello');
    await waitFor(() => call !== undefined);
    setup.runtime.interrupt();
    await turn;

    expect(call?.options.signal?.aborted).toBe(true);
    expect(setup.voice.interruptCount).toBe(1);
    expect(setup.runtime.activity).toBe('idle');
  });

  test('ignores signals while busy and accepts them while idle', async () => {
    const calls: RunCall[] = [];
    const firstCompletion = deferred<void>();
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        return {
          completed:
            calls.length === 1 ? firstCompletion.promise : Promise.resolve(),
        };
      }),
    );

    const turn = setup.runtime.turn('hello');
    await waitFor(() => calls.length === 1);
    await setup.runtime.wake({ type: 'idle', forMs: 1_000 });
    expect(calls).toHaveLength(1);

    firstCompletion.resolve();
    await turn;
    await setup.runtime.wake({ type: 'startup' });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toEqual([
      {
        role: 'system',
        content: 'Lifecycle signal: {"type":"startup"}',
      },
    ]);
  });

  test('tracks say as speaking without exposing final model text', async () => {
    const utterance = deferred<UtteranceResult>();
    const setup = fixture(
      fakeRunner(({ options }) => {
        const context = options.context as AmadeusContext;
        const speech = context.voice.say('I am here.');
        return { completed: speech.done.then(() => {}) };
      }),
    );
    setup.voice.nextUtterance = utterance;

    const turn = setup.runtime.turn('hello');
    await waitFor(() => setup.runtime.activity === 'speaking');
    expect(setup.voice.sayText).toBe('I am here.');

    utterance.resolve({ status: 'finished' });
    await turn;

    expect(setup.activities).toEqual([
      'thinking',
      'speaking',
      'thinking',
      'idle',
    ]);
  });

  test('does not require an activity observer', async () => {
    const voice = new FakeVoice();
    const runtime = new AmadeusRuntime({
      runner: fakeRunner(() => ({ completed: Promise.resolve() })),
      context: {
        voice,
        memory: {} as AmadeusContext['memory'],
      },
      session: fakeSession(),
    });

    await runtime.turn('hello');
    expect(runtime.activity).toBe('idle');
  });

  test('activity observer failures do not fail the turn', async () => {
    const voice = new FakeVoice();
    let observations = 0;
    const runtime = new AmadeusRuntime({
      runner: fakeRunner(() => ({ completed: Promise.resolve() })),
      context: {
        voice,
        memory: {} as AmadeusContext['memory'],
      },
      session: fakeSession(),
      onActivity: () => {
        observations += 1;
        if (observations === 1) {
          throw new Error('observer unavailable');
        }
        return Promise.reject(new Error('observer unavailable'));
      },
    });

    await runtime.turn('hello');
    await Promise.resolve();
    expect(runtime.activity).toBe('idle');
    expect(observations).toBe(2);
  });

  test('restores idle after a runner failure', async () => {
    const error = new Error('model unavailable');
    const setup = fixture(
      fakeRunner(() => ({ completed: Promise.reject(error) })),
    );

    await expect(setup.runtime.turn('hello')).rejects.toBe(error);
    expect(setup.runtime.activity).toBe('idle');
  });

  test('rejects an empty user turn without starting a run', async () => {
    let runs = 0;
    const setup = fixture(
      fakeRunner(() => {
        runs += 1;
        return { completed: Promise.resolve() };
      }),
    );

    await expect(setup.runtime.turn('   ')).rejects.toBeInstanceOf(TypeError);
    expect(runs).toBe(0);
  });
});
