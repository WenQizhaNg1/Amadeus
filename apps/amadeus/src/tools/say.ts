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

const sayJsonProperties = {
  text: {
    type: 'string',
    minLength: 1,
    description: 'The non-empty text to speak aloud.',
  },
  emotion: { type: 'string' },
  speed: { type: 'number', exclusiveMinimum: 0 },
  interruptible: { type: 'boolean' },
} as const;

const sayJsonSchema = {
  type: 'object',
  properties: sayJsonProperties,
  required: ['text'] as (keyof typeof sayJsonProperties)[],
  additionalProperties: true,
} as const;

export const sayTool = tool<
  typeof sayJsonSchema,
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
  parameters: sayJsonSchema,
  strict: false,
  outputSchema: sayResult,
  async execute(input, runContext) {
    if (!runContext) {
      throw new Error('The say tool requires an Amadeus run context.');
    }

    const args = sayParameters.parse(input);
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
