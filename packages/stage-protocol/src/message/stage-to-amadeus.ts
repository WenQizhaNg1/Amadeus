import { z } from 'zod';

import { audioFormatSchema } from '../audio/format.ts';
import { protocolVersionSchema } from '../version/protocol-version.ts';
import { idSchema, textSchema } from './shared.ts';

const stageReadyMessageSchema = z.object({
  type: z.literal('stage.ready'),
  protocolVersion: protocolVersionSchema,
});

const inputTextMessageSchema = z.object({
  type: z.literal('input.text'),
  requestId: idSchema,
  text: textSchema,
});

const userInterruptMessageSchema = z.object({
  type: z.literal('user.interrupt'),
});

const microphoneStartMessageSchema = z.object({
  type: z.literal('mic.start'),
  format: audioFormatSchema,
});

const microphoneStopMessageSchema = z.object({
  type: z.literal('mic.stop'),
  streamId: idSchema,
});

const speakerPlayedMessageSchema = z.object({
  type: z.literal('speaker.played'),
  streamId: idSchema,
});

/** JSON messages sent from Stage to the Bun runtime. */
export const stageToAmadeusMessageSchema = z.discriminatedUnion('type', [
  stageReadyMessageSchema,
  inputTextMessageSchema,
  userInterruptMessageSchema,
  microphoneStartMessageSchema,
  microphoneStopMessageSchema,
  speakerPlayedMessageSchema,
]);

export type StageToAmadeusMessage = z.infer<
  typeof stageToAmadeusMessageSchema
>;
