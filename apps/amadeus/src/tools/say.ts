import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../context.ts';
import type { UtteranceResult } from '../voice/utterance.ts';

export const sayParameters = z.object({
  text: z.string().trim().min(1),
  emotion: z.string().trim().min(1).optional(),
  speed: z.number().positive().optional(),
});

const sayJsonProperties = {
  text: {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description: 'The non-empty text to speak aloud.',
  },
  emotion: { type: 'string', minLength: 1, pattern: '\\S' },
  speed: { type: 'number', exclusiveMinimum: 0 },
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
  UtteranceResult
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
  errorFunction: null,
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
    });

    return await utterance.done;
  },
});
