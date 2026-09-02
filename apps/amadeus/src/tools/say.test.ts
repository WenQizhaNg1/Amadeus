import { describe, expect, test } from 'bun:test';
import { RunContext } from '@openai/agents';

import type { AmadeusContext } from '../context.ts';
import type { Voice } from '../voice/voice.ts';
import type { UtteranceResult } from '../voice/utterance.ts';
import { sayTool } from './say.ts';

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
      memory: {} as AmadeusContext['memory'],
    },
  };
}

describe('sayTool', () => {
  test('waits for and returns a finished utterance', async () => {
    const fixture = contextWithResult({ status: 'finished' });
    const result = await sayTool.invoke(
      new RunContext(fixture.context),
      JSON.stringify({ text: ' Hello. ', interruptible: true }),
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
});
