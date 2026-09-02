import type { AudioFrame } from './audio.ts';

export interface SpeechStyle {
  voice?: string;
  emotion?: string;
  speed?: number;
}

/** Converts one already-decided utterance into streaming audio. */
export interface Synthesizer {
  synthesize(
    text: string,
    options?: SpeechStyle,
    signal?: AbortSignal,
  ): AsyncIterable<AudioFrame>;
}
