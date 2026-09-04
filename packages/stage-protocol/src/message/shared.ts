import { z } from 'zod';

export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Invalid identifier.');

export const textSchema = z
  .string()
  .max(32_768)
  .refine((text) => text.trim().length > 0, 'Text must not be empty.');

export const stageActivitySchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'speaking',
]);

export type StageActivity = z.infer<typeof stageActivitySchema>;

export const cueSchema = z.object({
  emotion: z.string().min(1).max(64).optional(),
  motion: z.string().min(1).max(64).optional(),
  gaze: z.enum(['user', 'away', 'screen']).optional(),
});

export type Cue = z.infer<typeof cueSchema>;

export const speakerStopReasonSchema = z.enum([
  'completed',
  'interrupted',
  'failed',
]);

export type SpeakerStopReason = z.infer<typeof speakerStopReasonSchema>;

export const utteranceEndStatusSchema = z.enum([
  'finished',
  'interrupted',
  'failed',
]);

export type UtteranceEndStatus = z.infer<typeof utteranceEndStatusSchema>;

export const stageProtocolErrorCodeSchema = z.enum([
  'protocol.invalid_message',
  'protocol.unsupported_version',
  'protocol.invalid_state',
  'runtime.input_rejected',
  'runtime.failed',
  'voice.failed',
]);

export type StageProtocolErrorCode = z.infer<
  typeof stageProtocolErrorCodeSchema
>;
