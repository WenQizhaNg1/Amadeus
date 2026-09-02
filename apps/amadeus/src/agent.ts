import { Agent, type Model } from '@openai/agents';

import type { AmadeusContext } from './context.ts';
import { sayTool } from './tools/say.ts';

export const coreInstructions = `
These protocol rules take priority over the Identity section below.

The say tool is the only way to communicate user-facing language. Never put a
reply for the user in your final output. Choose whether to say nothing, speak
once, or make several ordered tool calls. A lifecycle signal usually deserves
silence unless there is a concrete reason to act.

When all actions for the turn are complete, return only DONE. This final marker
is internal and is never shown to the user.
`.trim();

export type AmadeusAgent = Agent<AmadeusContext>;

export interface CreateAgentOptions {
  model: Model;
  identity: string;
}

export function createAgent(options: CreateAgentOptions): AmadeusAgent {
  const identity = options.identity.trim();
  if (!identity) {
    throw new TypeError('Identity must not be empty.');
  }

  return new Agent({
    name: 'AMADEUS',
    instructions: `${coreInstructions}\n\nIdentity\n--------\n${identity}`,
    tools: [sayTool],
    model: options.model,
    modelSettings: {
      parallelToolCalls: false,
    },
  });
}
