import type { RunStreamEvent } from '@openai/agents';

export interface ObservableAgentRun extends AsyncIterable<RunStreamEvent> {
  readonly error: unknown;
  readonly finalOutput?: unknown;
}

export interface AgentRunObserver {
  observe(run: ObservableAgentRun): Promise<void>;
}
