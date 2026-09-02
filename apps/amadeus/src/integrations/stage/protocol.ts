import type { Activity } from '../../activity.ts';
import type { AudioFormat } from '../../voice/audio.ts';
import type { Cue } from './cue.ts';

export type SpeakerStopReason = 'completed' | 'interrupted' | 'failed';
export type UtteranceEndStatus = 'finished' | 'interrupted' | 'failed';

/** JSON messages sent from Stage to the Bun runtime. Audio uses binary frames. */
export type StageToAmadeusMessage =
  | { type: 'stage.ready' }
  | { type: 'mic.start'; format: AudioFormat }
  | { type: 'mic.stop'; streamId: string }
  | { type: 'input.text'; text: string }
  | { type: 'user.interrupt' }
  | { type: 'speaker.played'; streamId: string };

/** JSON messages sent from the Bun runtime to Stage. Audio uses binary frames. */
export type AmadeusToStageMessage =
  | { type: 'activity'; activity: Activity }
  | { type: 'transcript.partial'; text: string }
  | { type: 'transcript.final'; text: string }
  | { type: 'utterance.start'; utteranceId: string }
  | {
      type: 'utterance.end';
      utteranceId: string;
      status: UtteranceEndStatus;
    }
  | { type: 'cue'; cue: Cue }
  | {
      type: 'speaker.start';
      utteranceId: string;
      format: AudioFormat;
    }
  | {
      type: 'speaker.stop';
      streamId: string;
      reason: SpeakerStopReason;
    }
  | { type: 'error'; message: string; recoverable: boolean };

/** One side of the local Stage WebSocket, without binding to a WS library. */
export interface StageLink {
  send(message: AmadeusToStageMessage): void | Promise<void>;
  sendAudio(frame: Uint8Array): void | Promise<void>;
}
