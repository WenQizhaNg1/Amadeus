import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION } from '@amadeus/stage-protocol';

import {
  initialStageState,
  stageReducer,
  type StageState,
} from '../../src/application/stage-state.ts';

describe('stageReducer', () => {
  test('starts interaction and becomes ready from a state snapshot', () => {
    const failed = stageReducer(initialStageState, {
      type: 'error.raised',
      error: {
        code: 'stage.transport_failed',
        message: 'Connection failed.',
        recoverable: true,
      },
    });
    const started = stageReducer(failed, {
      type: 'interaction.started',
    });
    const connecting = stageReducer(started, {
      type: 'connection.changed',
      status: 'awaiting-state',
    });
    const ready = stageReducer(connecting, {
      type: 'message.received',
      message: {
        type: 'stage.state',
        protocolVersion: PROTOCOL_VERSION,
        activity: 'thinking',
      },
    });

    expect(ready).toMatchObject({
      interactionStarted: true,
      connection: 'ready',
      activity: 'thinking',
      error: undefined,
    });
  });

  test('tracks request acknowledgement and correlated errors', () => {
    const pending = stageReducer(initialStageState, {
      type: 'input.submitted',
      requestId: 'request-1',
    });
    const unrelated = stageReducer(pending, {
      type: 'message.received',
      message: { type: 'input.accepted', requestId: 'request-2' },
    });
    const failed = stageReducer(unrelated, {
      type: 'message.received',
      message: {
        type: 'error',
        code: 'runtime.input_rejected',
        message: 'Input was rejected.',
        recoverable: true,
        requestId: 'request-1',
      },
    });

    expect(unrelated).toBe(pending);
    expect(failed.pendingRequestId).toBeUndefined();
    expect(failed.error).toEqual({
      code: 'runtime.input_rejected',
      message: 'Input was rejected.',
      recoverable: true,
      requestId: 'request-1',
    });
  });

  test('tracks transcripts and the current utterance by stable ID', () => {
    const partial = stageReducer(initialStageState, {
      type: 'message.received',
      message: {
        type: 'transcript.partial',
        streamId: 'microphone-1',
        text: 'Hel',
      },
    });
    const final = stageReducer(partial, {
      type: 'message.received',
      message: {
        type: 'transcript.final',
        streamId: 'microphone-1',
        text: 'Hello.',
      },
    });
    const speaking = stageReducer(final, {
      type: 'message.received',
      message: {
        type: 'utterance.start',
        utteranceId: 'utterance-1',
        text: 'Hello.',
      },
    });
    const staleEnd = stageReducer(speaking, {
      type: 'message.received',
      message: {
        type: 'utterance.end',
        utteranceId: 'utterance-old',
        status: 'interrupted',
      },
    });
    const ended = stageReducer(staleEnd, {
      type: 'message.received',
      message: {
        type: 'utterance.end',
        utteranceId: 'utterance-1',
        status: 'finished',
      },
    });

    expect(final.transcript).toEqual({
      streamId: 'microphone-1',
      text: 'Hello.',
      final: true,
    });
    expect(staleEnd).toBe(speaking);
    expect(ended.utterance).toBeUndefined();
    expect(ended.subtitle).toBe('Hello.');
  });

  test('clears volatile state after disconnecting', () => {
    const state: StageState = {
      ...initialStageState,
      interactionStarted: true,
      connection: 'ready',
      activity: 'speaking',
      microphone: 'listening',
      transcript: { streamId: 'microphone-1', text: 'Hello', final: false },
      utterance: { id: 'utterance-1', text: 'Hello.' },
      subtitle: 'Hello.',
      pendingRequestId: 'request-1',
    };

    expect(
      stageReducer(state, {
        type: 'connection.changed',
        status: 'disconnected',
      }),
    ).toEqual({
      interactionStarted: true,
      connection: 'disconnected',
      activity: 'idle',
      microphone: 'inactive',
      transcript: undefined,
      utterance: undefined,
      subtitle: undefined,
      pendingRequestId: undefined,
    });
  });
});
