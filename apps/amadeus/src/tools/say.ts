import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../agent/context.ts';
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
    description: '要向用户表达的非空文本。',
  },
  emotion: {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description: '可选的表达情绪或风格。',
  },
  speed: {
    type: 'number',
    exclusiveMinimum: 0,
    description: '可选的相对语速，必须大于 0。',
  },
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
向用户表达语言内容。这是用户看到或听到回复的唯一通道。请自行决定措辞、长度、语气
以及分几次表达。调用会在本次表达完成或被打断后结束。
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
