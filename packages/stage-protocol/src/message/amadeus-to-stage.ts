import { z } from 'zod';

import { audioFormatSchema } from '../audio/format.ts';
import { protocolVersionSchema } from '../version/protocol-version.ts';
import {
  cueSchema,
  idSchema,
  speakerStopReasonSchema,
  stageActivitySchema,
  stageProtocolErrorCodeSchema,
  textSchema,
  utteranceEndStatusSchema,
} from './shared.ts';

const stageStateMessageSchema = z.object({
  type: z.literal('stage.state'),
  protocolVersion: protocolVersionSchema,
  activity: stageActivitySchema,
});

const inputAcceptedMessageSchema = z.object({
  type: z.literal('input.accepted'),
  requestId: idSchema,
});

const activityMessageSchema = z.object({
  type: z.literal('activity'),
  activity: stageActivitySchema,
});

const partialTranscriptMessageSchema = z.object({
  type: z.literal('transcript.partial'),
  streamId: idSchema,
  text: z.string().max(32_768),
});

const finalTranscriptMessageSchema = z.object({
  type: z.literal('transcript.final'),
  streamId: idSchema,
  text: z.string().max(32_768),
});

const utteranceStartMessageSchema = z.object({
  type: z.literal('utterance.start'),
  utteranceId: idSchema,
  text: textSchema,
});

const utteranceEndMessageSchema = z.object({
  type: z.literal('utterance.end'),
  utteranceId: idSchema,
  status: utteranceEndStatusSchema,
});

const cueMessageSchema = z.object({
  type: z.literal('cue'),
  cue: cueSchema,
});

const speakerStartMessageSchema = z.object({
  type: z.literal('speaker.start'),
  utteranceId: idSchema,
  format: audioFormatSchema,
});

const speakerStopMessageSchema = z.object({
  type: z.literal('speaker.stop'),
  streamId: idSchema,
  reason: speakerStopReasonSchema,
});

const errorMessageSchema = z.object({
  type: z.literal('error'),
  code: stageProtocolErrorCodeSchema,
  message: z.string().min(1).max(4_096),
  recoverable: z.boolean(),
  requestId: idSchema.optional(),
});

/** JSON messages sent from the Bun runtime to Stage. */
export const amadeusToStageMessageSchema = z.discriminatedUnion('type', [
  stageStateMessageSchema,
  inputAcceptedMessageSchema,
  activityMessageSchema,
  partialTranscriptMessageSchema,
  finalTranscriptMessageSchema,
  utteranceStartMessageSchema,
  utteranceEndMessageSchema,
  cueMessageSchema,
  speakerStartMessageSchema,
  speakerStopMessageSchema,
  errorMessageSchema,
]);

export type AmadeusToStageMessage = z.infer<
  typeof amadeusToStageMessageSchema
>;
