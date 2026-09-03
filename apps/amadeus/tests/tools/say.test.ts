import { describe, expect, test } from 'bun:test';
import { RunContext } from '@openai/agents';

import type { AmadeusContext } from '../../src/context.ts';
import type { Memory } from '../../src/memory/memory.ts';
import type { Voice } from '../../src/voice/voice.ts';
import type { UtteranceResult } from '../../src/voice/utterance.ts';
import { sayTool } from '../../src/tools/say.ts';

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
