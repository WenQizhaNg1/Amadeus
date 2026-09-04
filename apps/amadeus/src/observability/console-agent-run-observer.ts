import type { RunStreamEvent } from '@openai/agents';

import type {
  AgentRunObserver,
  ObservableAgentRun,
} from './agent-run-observer.ts';

const MAX_VALUE_LENGTH = 4_096;

export interface ConsoleAgentRunObserverOptions {
  writeLine?: (line: string) => void;
}

function truncate(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_VALUE_LENGTH)}…`;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return truncate(`${value.name}: ${value.message}`);
  }
  if (typeof value === 'string') {
    return truncate(value);
  }
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return truncate(String(value));
  }
}

function assistantText(event: RunStreamEvent): string | undefined {
  if (
    event.type !== 'run_item_stream_event' ||
    event.name !== 'message_output_created'
  ) {
    return undefined;
  }
  const raw = event.item.rawItem;
  if (!raw || !('role' in raw) || raw.role !== 'assistant') {
    return undefined;
  }
  return raw.content
    .flatMap((part) => {
      if (part.type === 'output_text') {
        return part.text;
      }
      if (part.type === 'refusal') {
        return `[拒绝] ${part.refusal}`;
      }
      return [];
    })
    .join('');
}

export class ConsoleAgentRunObserver implements AgentRunObserver {
  readonly #writeLine: (line: string) => void;

  constructor(options: ConsoleAgentRunObserverOptions = {}) {
    this.#writeLine =
      options.writeLine ?? ((line) => process.stderr.write(`${line}\n`));
  }

  async observe(run: ObservableAgentRun): Promise<void> {
    let modelTurn = 0;
    this.#writeLine('[agent] 运行开始');

    try {
      for await (const event of run) {
        if (event.type === 'raw_model_stream_event') {
          if (event.data.type === 'response_started') {
            modelTurn += 1;
            this.#writeLine(`[agent] 模型轮次 #${modelTurn} 开始`);
          } else if (event.data.type === 'response_done') {
            const usage = event.data.response.usage;
            this.#writeLine(
              `[agent] 模型轮次 #${modelTurn} 完成 tokens=${usage.inputTokens}+${usage.outputTokens}`,
            );
          }
          continue;
        }

        if (event.type === 'agent_updated_stream_event') {
          this.#writeLine(`[agent] 当前 Agent: ${event.agent.name}`);
          continue;
        }

        const raw = event.item.rawItem;
        switch (event.name) {
          case 'reasoning_item_created': {
            const summary =
              raw?.type === 'reasoning'
                ? raw.content.map(({ text }) => text).join('\n').trim()
                : '';
            this.#writeLine(
              summary
                ? `[agent] 思考摘要 #${modelTurn}: ${truncate(summary)}`
                : `[agent] 思考摘要 #${modelTurn}: （提供商未返回公开摘要）`,
            );
            break;
          }
          case 'tool_called':
            if (raw?.type === 'function_call') {
              this.#writeLine(
                `[agent] 工具选择 #${modelTurn}: ${raw.name} ${formatValue(raw.arguments)}`,
              );
            }
            break;
          case 'tool_output':
            if (raw?.type === 'function_call_result') {
              this.#writeLine(
                `[agent] 工具结果 #${modelTurn}: ${raw.name} ${formatValue(raw.output)}`,
              );
            }
            break;
          case 'message_output_created': {
            const text = assistantText(event)?.trim();
            if (text) {
              this.#writeLine(
                `[agent] 模型回答 #${modelTurn}: ${truncate(text)}`,
              );
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      this.#writeLine(`[agent] 运行失败: ${formatValue(error)}`);
      return;
    }

    if (run.error != null) {
      this.#writeLine(`[agent] 运行失败: ${formatValue(run.error)}`);
      return;
    }
    this.#writeLine(`[agent] 最终输出: ${formatValue(run.finalOutput)}`);
  }
}
