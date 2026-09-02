import { describe, expect, test } from 'bun:test';
import type { AgentInputItem } from '@openai/agents';

import { contextWindow, selectRecentContext } from './context-window.ts';

function message(
  role: 'user' | 'assistant' | 'system',
  content: string,
): AgentInputItem {
  return { role, content } as AgentInputItem;
}

function size(items: AgentInputItem[]): number {
  return items.reduce((total, item) => total + JSON.stringify(item).length, 0);
}

describe('selectRecentContext', () => {
  test('returns new input unchanged when history is empty', () => {
    const input = [message('user', 'now')];
    expect(selectRecentContext([], input, 0)).toEqual(input);
  });

  test('keeps all complete turns that fit the budget', () => {
    const first = [message('user', 'first'), message('assistant', 'one')];
    const second = [message('system', 'signal'), message('assistant', 'two')];
    const input = [message('user', 'now')];

    expect(
      selectRecentContext([...first, ...second], input, size([...first, ...second])),
    ).toEqual([...first, ...second, ...input]);
    expect(
      selectRecentContext([...first, ...second], input, size(second)),
    ).toEqual([...second, ...input]);
  });

  test('retains the newest complete turn even when it exceeds the budget', () => {
    const old = [message('user', 'old'), message('assistant', 'answer')];
    const latest = [
      message('user', 'latest'),
      { type: 'function_call', callId: 'call-1', name: 'say', arguments: '{}' },
      {
        type: 'function_call_result',
        callId: 'call-1',
        name: 'say',
        output: { type: 'text', text: 'done' },
      },
      message('assistant', 'complete'),
    ] as AgentInputItem[];
    const input = [message('user', 'now')];

    expect(selectRecentContext([...old, ...latest], input, 0)).toEqual([
      ...latest,
      ...input,
    ]);
  });

  test('keeps leading provider items attached to the first real turn', () => {
    const history = [
      { type: 'reasoning', content: [] },
      message('user', 'first'),
      message('assistant', 'one'),
      message('user', 'second'),
      message('assistant', 'two'),
    ] as AgentInputItem[];
    const latest = history.slice(3);

    expect(selectRecentContext(history, [], size(latest))).toEqual(latest);
  });

  test('validates the budget and exposes a reusable callback', async () => {
    expect(() => selectRecentContext([], [], -1)).toThrow(RangeError);
    expect(() => selectRecentContext([], [], 1.5)).toThrow(RangeError);

    const latest = [message('user', 'latest')];
    expect(await contextWindow(0)(latest, [])).toEqual(latest);
  });
});
