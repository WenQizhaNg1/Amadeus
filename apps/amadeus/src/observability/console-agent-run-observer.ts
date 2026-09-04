import type { RunStreamEvent } from '@openai/agents';
import picocolors from 'picocolors';

import type {
  AgentRunObserver,
  ObservableAgentRun,
} from './agent-run-observer.ts';

const MAX_VALUE_LENGTH = 4_096;

export interface ConsoleAgentRunObserverOptions {
  writeLine?: (line: string) => void;
  colors?: boolean;
}

type Paint = (value: string) => string;

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

function unwrapToolValue(value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'text' &&
    'text' in value &&
    typeof value.text === 'string'
  ) {
    return value.text;
  }
  return value;
}

function formatToolValue(value: unknown): string {
  const unwrapped = unwrapToolValue(value);
  if (typeof unwrapped !== 'string') {
    return formatValue(unwrapped);
  }

  try {
    return formatValue(JSON.parse(unwrapped));
  } catch {
    return formatValue(unwrapped);
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
  readonly #colors: ReturnType<typeof picocolors.createColors>;

  constructor(options: ConsoleAgentRunObserverOptions = {}) {
    this.#writeLine =
      options.writeLine ?? ((line) => process.stderr.write(`${line}\n`));
    this.#colors = picocolors.createColors(options.colors);
  }

  async observe(run: ObservableAgentRun): Promise<void> {
    let modelTurn = 0;
    this.#writeEvent('┌', '运行开始', undefined, this.#colors.bold);

    try {
      for await (const event of run) {
        if (event.type === 'raw_model_stream_event') {
          if (event.data.type === 'response_started') {
            modelTurn += 1;
            this.#writeEvent(
              '├',
              `模型 #${modelTurn}`,
              '开始',
              this.#colors.blue,
            );
          } else if (event.data.type === 'response_done') {
            const usage = event.data.response.usage;
            this.#writeEvent(
              '├',
              `模型 #${modelTurn}`,
              `完成 · 输入 ${usage.inputTokens.toLocaleString()} · 输出 ${usage.outputTokens.toLocaleString()}`,
              this.#colors.blue,
            );
          }
          continue;
        }

        if (event.type === 'agent_updated_stream_event') {
          this.#writeEvent(
            '├',
            '切换 Agent',
            event.agent.name,
            this.#colors.cyan,
          );
          continue;
        }

        const raw = event.item.rawItem;
        switch (event.name) {
          case 'reasoning_item_created': {
            const summary =
              raw?.type === 'reasoning'
                ? raw.content.map(({ text }) => text).join('\n').trim()
                : '';
            this.#writeEvent(
              '├',
              `思考 #${modelTurn}`,
              summary
                ? truncate(summary)
                : '（提供商未返回公开摘要）',
              this.#colors.magenta,
            );
            break;
          }
          case 'tool_called':
            if (raw?.type === 'function_call') {
              this.#writeEvent(
                '├',
                `工具 #${modelTurn}`,
                `${this.#colors.bold(raw.name)} ${formatToolValue(raw.arguments)}`,
                this.#colors.yellow,
              );
            }
            break;
          case 'tool_output':
            if (raw?.type === 'function_call_result') {
              this.#writeEvent(
                '├',
                `结果 #${modelTurn}`,
                `${this.#colors.bold(raw.name)} ${formatToolValue(raw.output)}`,
                this.#colors.green,
              );
            }
            break;
          case 'message_output_created': {
            const text = assistantText(event)?.trim();
            if (text) {
              this.#writeEvent(
                '├',
                `回答 #${modelTurn}`,
                truncate(text),
                this.#colors.cyan,
              );
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      this.#writeEvent(
        '└',
        '运行失败',
        formatValue(error),
        this.#colors.red,
      );
      return;
    }

    if (run.error != null) {
      this.#writeEvent(
        '└',
        '运行失败',
        formatValue(run.error),
        this.#colors.red,
      );
      return;
    }
    this.#writeEvent(
      '└',
      '运行完成',
      formatValue(run.finalOutput),
      this.#colors.green,
    );
  }

  #writeEvent(
    branch: string,
    label: string,
    detail: string | undefined,
    paint: Paint,
  ): void {
    const prefix = `${this.#colors.dim('[agent]')} ${this.#colors.dim(branch)}`;
    const suffix = detail ? `${this.#colors.dim(' · ')}${detail}` : '';
    this.#writeLine(`${prefix} ${paint(label)}${suffix}`);
  }
}
