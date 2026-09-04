import type {
  AmadeusToStageMessage,
  StageActivity,
  StageProtocolErrorCode,
} from '@amadeus/stage-protocol';

import type { ConnectionStatus } from '../transport/stage-transport.ts';

export type MicrophoneStatus =
  | 'inactive'
  | 'requesting'
  | 'listening'
  | 'blocked';

export type StageErrorCode = StageProtocolErrorCode | 'stage.transport_failed';

export interface StageError {
  code: StageErrorCode;
  message: string;
  recoverable: boolean;
  requestId?: string;
}

export interface StageState {
  interactionStarted: boolean;
  connection: ConnectionStatus;
  activity: StageActivity;
  microphone: MicrophoneStatus;
  transcript?: {
    streamId: string;
    text: string;
    final: boolean;
  };
  utterance?: {
    id: string;
    text: string;
  };
  pendingRequestId?: string;
  error?: StageError;
}

export type StageAction =
  | { type: 'interaction.started' }
  | { type: 'connection.changed'; status: ConnectionStatus }
  | { type: 'microphone.changed'; status: MicrophoneStatus }
  | { type: 'input.submitted'; requestId: string }
  | { type: 'message.received'; message: AmadeusToStageMessage }
  | { type: 'error.raised'; error: StageError }
  | { type: 'error.dismissed' };

export const initialStageState: StageState = {
  interactionStarted: false,
  connection: 'disconnected',
  activity: 'idle',
  microphone: 'inactive',
};

function receiveMessage(
  state: StageState,
  message: AmadeusToStageMessage,
): StageState {
  switch (message.type) {
    case 'stage.state':
      return {
        ...state,
        connection: 'ready',
        activity: message.activity,
      };
    case 'input.accepted':
      return message.requestId === state.pendingRequestId
        ? { ...state, pendingRequestId: undefined }
        : state;
    case 'activity':
      return { ...state, activity: message.activity };
    case 'transcript.partial':
    case 'transcript.final':
      return {
        ...state,
        transcript: {
          streamId: message.streamId,
          text: message.text,
          final: message.type === 'transcript.final',
        },
      };
    case 'utterance.start':
      return {
        ...state,
        utterance: { id: message.utteranceId, text: message.text },
      };
    case 'utterance.end':
      return message.utteranceId === state.utterance?.id
        ? { ...state, utterance: undefined }
        : state;
    case 'error':
      return {
        ...state,
        pendingRequestId:
          message.requestId === state.pendingRequestId
            ? undefined
            : state.pendingRequestId,
        error: {
          code: message.code,
          message: message.message,
          recoverable: message.recoverable,
          requestId: message.requestId,
        },
      };
    case 'cue':
    case 'speaker.start':
    case 'speaker.stop':
      return state;
  }
}

export function stageReducer(
  state: StageState,
  action: StageAction,
): StageState {
  switch (action.type) {
    case 'interaction.started':
      return { ...state, interactionStarted: true };
    case 'connection.changed':
      if (action.status !== 'disconnected') {
        return { ...state, connection: action.status };
      }
      return {
        ...state,
        connection: 'disconnected',
        activity: 'idle',
        microphone: 'inactive',
        transcript: undefined,
        utterance: undefined,
        pendingRequestId: undefined,
      };
    case 'microphone.changed':
      return { ...state, microphone: action.status };
    case 'input.submitted':
      return { ...state, pendingRequestId: action.requestId, error: undefined };
    case 'message.received':
      return receiveMessage(state, action.message);
    case 'error.raised':
      return {
        ...state,
        pendingRequestId: undefined,
        error: action.error,
      };
    case 'error.dismissed':
      return { ...state, error: undefined };
  }
}
