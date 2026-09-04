import { z } from 'zod';

import { idSchema } from '../message/shared.ts';

export const audioEncodingSchema = z.enum(['f32le', 's16le']);

export type AudioEncoding = z.infer<typeof audioEncodingSchema>;

export const audioFormatSchema = z.object({
  streamId: idSchema,
  sampleRate: z.number().int().min(8_000).max(384_000),
  channels: z.number().int().min(1).max(8),
  encoding: audioEncodingSchema,
});

export type AudioFormat = z.infer<typeof audioFormatSchema>;
