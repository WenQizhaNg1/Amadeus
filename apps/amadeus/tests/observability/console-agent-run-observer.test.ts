import { describe, expect, test } from 'bun:test';
import {
  Agent,
  RunItemStreamEvent,
  RunMessageOutputItem,
  RunRawModelStreamEvent,
  RunReasoningItem,
  RunToolCallItem,
  RunToolCallOutputItem,
  type Model,
  type RunStreamEvent,
} from '@openai/agents';

import type { ObservableAgentRun } from '../../src/observability/agent-run-observer.ts';
import { ConsoleAgentRunObserver } from '../../src/observability/console-agent-run-observer.ts';

const agent = new Agent({
  name: 'AMADEUS',
  instructions: 'test',
  model: {} as Model,
});

function run(
  events: RunStreamEvent[],
  options: { finalOutput?: unknown; error?: unknown } = {},
): ObservableAgentRun {
  return {
    error: options.error,
    finalOutput: options.finalOutput,
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };
}

describe('ConsoleAgentRunObserver', () => {
  test('prints model turns, public reasoning, tools and outputs', async () => {
    const lines: string[] = [];
    const observer = new ConsoleAgentRunObserver({
      writeLine: (line) => lines.push(line),
    });
    const events: RunStreamEvent[] = [
      new RunRawModelStreamEvent({ type: 'response_started' }),
      new RunRawModelStreamEvent({
        type: 'response_done',
        response: {
          id: 'response-1',
          output: [],
          usage: {
            requests: 1,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      }),
      new RunItemStreamEvent(
        'reasoning_item_created',
        new RunReasoningItem(
          {
            type: 'reasoning',
            content: [{ type: 'input_text', text: '需要向用户问好。' }],
          },
          agent,
        ),
      ),
      new RunItemStreamEvent(
        'tool_called',
        new RunToolCallItem(
          {
            type: 'function_call',
            callId: 'call-1',
            name: 'say',
            arguments: '{"text":"你好"}',
          },
          agent,
        ),
      ),
      new RunItemStreamEvent(
        'tool_output',
        new RunToolCallOutputItem(
          {
            type: 'function_call_result',
            callId: 'call-1',
            name: 'say',
            status: 'completed',
            output: '{"status":"finished"}',
          },
          agent,
          { status: 'finished' },
        ),
      ),
      new RunItemStreamEvent(
        'message_output_created',
        new RunMessageOutputItem(
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'DONE' }],
          },
          agent,
        ),
      ),
    ];

    await observer.observe(run(events, { finalOutput: 'DONE' }));

    expect(lines).toEqual([
      '[agent] 运行开始',
      '[agent] 模型轮次 #1 开始',
      '[agent] 模型轮次 #1 完成 tokens=10+5',
      '[agent] 思考摘要 #1: 需要向用户问好。',
      '[agent] 工具选择 #1: say {"text":"你好"}',
      '[agent] 工具结果 #1: say {"status":"finished"}',
      '[agent] 模型回答 #1: DONE',
      '[agent] 最终输出: DONE',
    ]);
  });

  test('reports unavailable reasoning and run failures', async () => {
    const lines: string[] = [];
    const observer = new ConsoleAgentRunObserver({
      writeLine: (line) => lines.push(line),
    });
    const events = [
      new RunRawModelStreamEvent({ type: 'response_started' }),
      new RunItemStreamEvent(
        'reasoning_item_created',
        new RunReasoningItem({ type: 'reasoning', content: [] }, agent),
      ),
    ];

    await observer.observe(run(events, { error: new Error('model failed') }));

    expect(lines).toEqual([
      '[agent] 运行开始',
      '[agent] 模型轮次 #1 开始',
      '[agent] 思考摘要 #1: （提供商未返回公开摘要）',
      '[agent] 运行失败: Error: model failed',
    ]);
  });
});
