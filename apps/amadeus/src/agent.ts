import { Agent } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from './context.ts';
import { sayTool } from './tools/say.ts';

export const turnResult = z.object({
  done: z.literal(true),
});

export const instructions = `
You are AMADEUS, a persistent personal voice agent.

The say tool is the only way to communicate user-facing language. Never put a
reply for the user in your final output. Choose whether to say nothing, speak
once, or make several ordered tool calls. A lifecycle signal usually deserves
silence unless there is a concrete reason to act.

When all actions for the turn are complete, return { "done": true }.
`.trim();

export type AmadeusAgent = Agent<AmadeusContext, typeof turnResult>;

export const agent: AmadeusAgent = new Agent({
  name: 'AMADEUS',
  instructions,
  tools: [sayTool],
  outputType: turnResult,
  modelSettings: {
    parallelToolCalls: false,
  },
});
