import { describe, expect, test } from 'bun:test';
import { RunContext } from '@openai/agents';

import type { AmadeusContext } from '../../src/agent/context.ts';
import type { Memory } from '../../src/memory/memory.ts';
import { VoiceBusyError, type Voice } from '../../src/voice/voice.ts';
import type { UtteranceResult } from '../../src/voice/utterance.ts';
import { sayTool } from '../../src/tools/say.ts';

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

function contextWithResult(result: UtteranceResult): {
  context: AmadeusContext;
  voice: Voice & { lastText?: string };
} {
  const voice: Voice & { lastText?: string } = {
    say(text) {
      voice.lastText = text;
      return {
        id: 'utterance-1',
        done: Promise.resolve(result),
        interrupt() {},
      };
    },
    interrupt() {},
  };

  return {
    voice,
    context: {
      voice,
      memory: {} as Memory,
      conversationId: 'conversation-1',
      now: () => 100,
    },
  };
}

describe('sayTool', () => {
  test('publishes the same required string constraints used locally', () => {
    expect(sayTool.parameters).toMatchObject({
      properties: {
        text: { minLength: 1, pattern: '\\S' },
        emotion: { minLength: 1, pattern: '\\S' },
      },
    });
    expect(sayTool.parameters.properties).not.toHaveProperty('interruptible');
  });

  test('waits for and returns a finished utterance', async () => {
    const fixture = contextWithResult({ status: 'finished' });
    const result = await sayTool.invoke(
      new RunContext(fixture.context),
      JSON.stringify({ text: ' Hello. ' }),
    );

    expect(result).toEqual({ status: 'finished' });
    expect(fixture.voice.lastText).toBe('Hello.');
  });

  test('returns interruption as a normal tool result', async () => {
    const fixture = contextWithResult({ status: 'interrupted' });
    const result = await sayTool.invoke(
      new RunContext(fixture.context),
      JSON.stringify({ text: 'Wait.' }),
    );

    expect(result).toEqual({ status: 'interrupted' });
  });

  test('serializes concurrent calls for a single voice', async () => {
    const firstDone = deferred<UtteranceResult>();
    const secondDone = deferred<UtteranceResult>();
    const started: string[] = [];
    let active = false;
    const voice: Voice = {
      say(text) {
        if (active) {
          throw new VoiceBusyError();
        }
        active = true;
        started.push(text);
        const done = started.length === 1 ? firstDone : secondDone;
        return {
          id: `utterance-${started.length}`,
          done: done.promise.then((result) => {
            active = false;
            return result;
          }),
          interrupt() {},
        };
      },
      interrupt() {},
    };
    const context: AmadeusContext = {
      voice,
      memory: {} as Memory,
      conversationId: 'conversation-1',
      now: () => 100,
    };

    const first = sayTool.invoke(
      new RunContext(context),
      JSON.stringify({ text: 'First.' }),
    );
    const second = sayTool.invoke(
      new RunContext(context),
      JSON.stringify({ text: 'Second.' }),
    );
    await Promise.resolve();

    expect(started).toEqual(['First.']);

    firstDone.resolve({ status: 'finished' });
    expect(await first).toEqual({ status: 'finished' });
    await Promise.resolve();
    expect(started).toEqual(['First.', 'Second.']);

    secondDone.resolve({ status: 'finished' });
    expect(await second).toEqual({ status: 'finished' });
  });

  test('rejects whitespace-only text and emotion', async () => {
    const fixture = contextWithResult({ status: 'finished' });

    await expect(
      sayTool.invoke(
        new RunContext(fixture.context),
        JSON.stringify({ text: '   ' }),
      ),
    ).rejects.toThrow();
    await expect(
      sayTool.invoke(
        new RunContext(fixture.context),
        JSON.stringify({ text: 'Hello.', emotion: '   ' }),
      ),
    ).rejects.toThrow();
  });
});
