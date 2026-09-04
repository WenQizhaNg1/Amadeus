import { describe, expect, test } from 'bun:test';

import {
  PROTOCOL_VERSION,
  amadeusToStageMessageSchema,
  audioFormatSchema,
  stageToAmadeusMessageSchema,
  type AmadeusToStageMessage,
  type AudioFormat,
  type StageToAmadeusMessage,
} from '../../src/main.ts';

const audioFormat: AudioFormat = {
  streamId: 'audio-1',
  sampleRate: 24_000,
  channels: 1,
  encoding: 'f32le',
};

const stageMessages: StageToAmadeusMessage[] = [
  { type: 'stage.ready', protocolVersion: PROTOCOL_VERSION },
  { type: 'input.text', requestId: 'request-1', text: 'Hello.' },
  { type: 'user.interrupt' },
  { type: 'mic.start', format: audioFormat },
  { type: 'mic.stop', streamId: audioFormat.streamId },
  { type: 'speaker.played', streamId: audioFormat.streamId },
];

const amadeusMessages: AmadeusToStageMessage[] = [
  {
    type: 'stage.state',
    protocolVersion: PROTOCOL_VERSION,
    activity: 'idle',
  },
  { type: 'input.accepted', requestId: 'request-1' },
  { type: 'activity', activity: 'thinking' },
  {
    type: 'transcript.partial',
    streamId: 'microphone-1',
    text: 'Hel',
  },
  {
    type: 'transcript.final',
    streamId: 'microphone-1',
    text: 'Hello.',
  },
  {
    type: 'utterance.start',
    utteranceId: 'utterance-1',
    text: 'Hello.',
  },
  {
    type: 'utterance.end',
    utteranceId: 'utterance-1',
    status: 'finished',
  },
  { type: 'cue', cue: { emotion: 'happy', gaze: 'user' } },
  {
    type: 'speaker.start',
    utteranceId: 'utterance-1',
    format: audioFormat,
  },
  {
    type: 'speaker.stop',
    streamId: audioFormat.streamId,
    reason: 'completed',
  },
  {
    type: 'error',
    code: 'runtime.input_rejected',
    message: 'Input was rejected.',
    recoverable: true,
    requestId: 'request-1',
  },
];

describe('Stage protocol messages', () => {
  test('round trips every Stage-to-Amadeus message', () => {
    for (const message of stageMessages) {
      const decoded: unknown = JSON.parse(JSON.stringify(message));
      expect(stageToAmadeusMessageSchema.parse(decoded)).toEqual(message);
    }
  });

  test('round trips every Amadeus-to-Stage message', () => {
    for (const message of amadeusMessages) {
      const decoded: unknown = JSON.parse(JSON.stringify(message));
      expect(amadeusToStageMessageSchema.parse(decoded)).toEqual(message);
    }
  });

  test('allows additive fields on known messages', () => {
    expect(
      stageToAmadeusMessageSchema.parse({
        type: 'stage.ready',
        protocolVersion: PROTOCOL_VERSION,
        futureField: true,
      }),
    ).toEqual({
      type: 'stage.ready',
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  test('rejects an unsupported protocol version', () => {
    expect(
      stageToAmadeusMessageSchema.safeParse({
        type: 'stage.ready',
        protocolVersion: PROTOCOL_VERSION + 1,
      }).success,
    ).toBeFalse();
  });

  test('rejects unknown message types', () => {
    expect(
      stageToAmadeusMessageSchema.safeParse({ type: 'stage.unknown' })
        .success,
    ).toBeFalse();
    expect(
      amadeusToStageMessageSchema.safeParse({ type: 'stage.unknown' })
        .success,
    ).toBeFalse();
  });

  test('rejects invalid text and identifiers', () => {
    expect(
      stageToAmadeusMessageSchema.safeParse({
        type: 'input.text',
        requestId: '   ',
        text: 'Hello.',
      }).success,
    ).toBeFalse();
    expect(
      stageToAmadeusMessageSchema.safeParse({
        type: 'input.text',
        requestId: 'request-1',
        text: '   ',
      }).success,
    ).toBeFalse();
  });

  test('rejects invalid audio formats', () => {
    expect(
      audioFormatSchema.safeParse({
        ...audioFormat,
        sampleRate: 7_999,
      }).success,
    ).toBeFalse();
    expect(
      audioFormatSchema.safeParse({
        ...audioFormat,
        channels: 0,
      }).success,
    ).toBeFalse();
    expect(
      audioFormatSchema.safeParse({
        ...audioFormat,
        encoding: 'mp3',
      }).success,
    ).toBeFalse();
  });

  test('rejects unknown error codes', () => {
    expect(
      amadeusToStageMessageSchema.safeParse({
        type: 'error',
        code: 'unknown',
        message: 'Unknown error.',
        recoverable: false,
      }).success,
    ).toBeFalse();
  });
});
