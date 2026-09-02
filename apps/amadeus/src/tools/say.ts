import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../context.ts';

export const sayParameters = z.object({
  text: z.string().trim().min(1),
  emotion: z.string().trim().min(1).optional(),
  speed: z.number().positive().optional(),
  interruptible: z.boolean().default(true),
});

export const sayResult = z.object({
  status: z.enum(['finished', 'interrupted']),
});

export const sayTool = tool<
  typeof sayParameters,
  AmadeusContext,
  z.infer<typeof sayResult>,
  typeof sayResult
>({
  name: 'say',
  description: `
Speak aloud to the user. Calling this tool is the only way to produce
user-facing speech. Choose the wording, length, tone, and number of
utterances yourself. The call completes only after the speech finishes or is
interrupted.
`.trim(),
  parameters: sayParameters,
  outputSchema: sayResult,
  async execute(args, runContext) {
    if (!runContext) {
      throw new Error('The say tool requires an Amadeus run context.');
    }

    const utterance = runContext.context.voice.say(args.text, {
      style: {
        emotion: args.emotion,
        speed: args.speed,
      },
      interruptible: args.interruptible,
    });

    return await utterance.done;
  },
});
