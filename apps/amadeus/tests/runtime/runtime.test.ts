import { describe, expect, test } from 'bun:test';
import type {
  AgentInputItem,
  Runner,
  Session,
  SessionInputCallback,
  StreamRunOptions,
} from '@openai/agents';

import type { AmadeusAgent } from '../../src/agent/agent.ts';
import type { AmadeusContext } from '../../src/agent/context.ts';
import type { Memory } from '../../src/memory/memory.ts';
import type { Activity } from '../../src/runtime/activity.ts';
import { AmadeusRuntime } from '../../src/runtime/runtime.ts';
import type { Utterance, UtteranceResult } from '../../src/voice/utterance.ts';
import type { Voice } from '../../src/voice/voice.ts';

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
  settleOnInterrupt = true;
  lastText?: string;
  nextUtterance?: Deferred<UtteranceResult>;

  say(text: string): Utterance {
    this.lastText = text;
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
    if (this.settleOnInterrupt) {
      this.nextUtterance?.resolve({ status: 'interrupted' });
    }
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

function fixture(
  runner: Runner,
  options: { sessionInputCallback?: SessionInputCallback } = {},
): {
  runtime: AmadeusRuntime;
  voice: FakeVoice;
  activities: Activity[];
  session: Session;
} {
  const voice = new FakeVoice();
  const activities: Activity[] = [];
  const session = fakeSession();
  return {
    runtime: new AmadeusRuntime({
      runner,
      agent: {} as AmadeusAgent,
      context: {
        voice,
        memory: {} as Memory,
        conversationId: 'test-session',
        now: () => 100,
      },
      session,
      sessionInputCallback: options.sessionInputCallback,
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
  test('runs a user turn with the expected SDK options', async () => {
    const calls: RunCall[] = [];
    const completion = deferred<void>();
    const callback: SessionInputCallback = (history, input) => [
      ...history,
      ...input,
    ];
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        return { completed: completion.promise, error: null };
      }),
      { sessionInputCallback: callback },
    );

    const turn = setup.runtime.turn(' Hello. ');
    await waitFor(() => calls.length === 1);

    expect(calls[0]?.input).toBe('Hello.');
    expect(calls[0]?.options.context).toBeDefined();
    expect(calls[0]?.options.session).toBe(setup.session);
    expect(calls[0]?.options.stream).toBe(true);
    expect(calls[0]?.options.sessionInputCallback).toBe(callback);
    expect(setup.runtime.activity).toBe('thinking');

    completion.resolve();
    await turn;
    expect(setup.runtime.activity).toBe('idle');
    expect(setup.activities).toEqual(['thinking', 'idle']);
  });

  test('runs only the latest turn when several are queued', async () => {
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

    expect(calls.map(({ input }) => input)).toEqual(['second']);
  });

  test('a new turn aborts active work and waits for it to settle', async () => {
    const calls: RunCall[] = [];
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        if (calls.length > 1) {
          return { completed: Promise.resolve() };
        }
        return {
          completed: new Promise<void>((_resolve, reject) => {
            call.options.signal?.addEventListener(
              'abort',
              () => reject(call.options.signal?.reason),
              { once: true },
            );
          }),
        };
      }),
    );

    const first = setup.runtime.turn('first');
    await waitFor(() => calls.length === 1);
    const second = setup.runtime.turn('second');
    await Promise.all([first, second]);

    expect(calls[0]?.options.signal?.aborted).toBe(true);
    expect(calls.map(({ input }) => input)).toEqual(['first', 'second']);
    expect(setup.voice.interruptCount).toBe(1);
  });

  test('does not hand off until interrupted speech settles', async () => {
    const calls: RunCall[] = [];
    const utterance = deferred<UtteranceResult>();
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        if (calls.length > 1) {
          return { completed: Promise.resolve() };
        }
        (call.options.context as AmadeusContext).voice.say('Still speaking.');
        return {
          completed: new Promise<void>((_resolve, reject) => {
            call.options.signal?.addEventListener(
              'abort',
              () => reject(call.options.signal?.reason),
              { once: true },
            );
          }),
        };
      }),
    );
    setup.voice.nextUtterance = utterance;
    setup.voice.settleOnInterrupt = false;

    const first = setup.runtime.turn('first');
    await waitFor(() => setup.runtime.activity === 'speaking');
    const second = setup.runtime.turn('second');
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    utterance.resolve({ status: 'interrupted' });
    await Promise.all([first, second]);
    expect(calls.map(({ input }) => input)).toEqual(['first', 'second']);
  });

  test('keeps only the latest queued turn while speech settles', async () => {
    const calls: RunCall[] = [];
    const utterance = deferred<UtteranceResult>();
    const setup = fixture(
      fakeRunner((call) => {
        calls.push(call);
        if (calls.length > 1) {
          return { completed: Promise.resolve() };
        }
        (call.options.context as AmadeusContext).voice.say('Still speaking.');
        return {
          completed: new Promise<void>((_resolve, reject) => {
            call.options.signal?.addEventListener(
              'abort',
              () => reject(call.options.signal?.reason),
              { once: true },
            );
          }),
        };
      }),
    );
    setup.voice.nextUtterance = utterance;
    setup.voice.settleOnInterrupt = false;

    const first = setup.runtime.turn('first');
    await waitFor(() => setup.runtime.activity === 'speaking');
    const second = setup.runtime.turn('second');
    const third = setup.runtime.turn('third');
    utterance.resolve({ status: 'interrupted' });

    await Promise.all([first, second, third]);
    expect(calls.map(({ input }) => input)).toEqual(['first', 'third']);
  });

  test('interrupt resolves only after the active handoff settles', async () => {
    const completion = deferred<void>();
    let started = false;
    const setup = fixture(
      fakeRunner(() => {
        started = true;
        return { completed: completion.promise, error: null };
      }),
    );

    const turn = setup.runtime.turn('hello');
    await waitFor(() => started);
    let interrupted = false;
    const interruption = setup.runtime.interrupt().then(() => {
      interrupted = true;
    });
    await Promise.resolve();
    expect(interrupted).toBe(false);

    completion.resolve();
    await Promise.all([turn, interruption]);
    expect(interrupted).toBe(true);
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
    expect(calls[1]?.input).toEqual([
      {
        role: 'system',
        content: '生命周期信号：{"type":"startup"}',
      },
    ]);
  });

  test('tracks speech activity until the utterance finishes', async () => {
    const utterance = deferred<UtteranceResult>();
    const setup = fixture(
      fakeRunner(({ options }) => {
        const speech = (options.context as AmadeusContext).voice.say(
          'I am here.',
        );
        return { completed: speech.done.then(() => {}) };
      }),
    );
    setup.voice.nextUtterance = utterance;

    const turn = setup.runtime.turn('hello');
    await waitFor(() => setup.runtime.activity === 'speaking');
    expect(setup.voice.lastText).toBe('I am here.');

    utterance.resolve({ status: 'finished' });
    await turn;
    expect(setup.activities).toEqual([
      'thinking',
      'speaking',
      'thinking',
      'idle',
    ]);
  });

  test('activity observer failures do not fail a turn', async () => {
    let observations = 0;
    const runtime = new AmadeusRuntime({
      runner: fakeRunner(() => ({ completed: Promise.resolve() })),
      agent: {} as AmadeusAgent,
      context: {
        voice: new FakeVoice(),
        memory: {} as Memory,
        conversationId: 'test-session',
        now: () => 100,
      },
      session: fakeSession(),
      onActivity: () => {
        observations += 1;
        throw new Error('observer unavailable');
      },
    });

    await runtime.turn('hello');
    await waitFor(() => observations === 2);
    expect(runtime.activity).toBe('idle');
  });

  test('restores idle after a runner failure', async () => {
    const error = new Error('model unavailable');
    const setup = fixture(
      fakeRunner(() => ({ completed: Promise.reject(error) })),
    );

    await expect(setup.runtime.turn('hello')).rejects.toBe(error);
    expect(setup.runtime.activity).toBe('idle');
  });

  test('rejects empty input without starting a run', async () => {
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
