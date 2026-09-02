import type { AudioFrame } from './audio.ts';

export type Transcript =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string };

export interface Transcriber {
  transcribe(
    audio: AsyncIterable<AudioFrame>,
    signal?: AbortSignal,
  ): AsyncIterable<Transcript>;
}
