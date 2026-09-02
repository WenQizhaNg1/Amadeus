import type { StageLink } from '../integrations/stage/protocol.ts';
import { encodeFloat32LE, validateAudioFrame } from './audio-encoding.ts';
import type { AudioFormat, AudioFrame } from './audio.ts';
import type { SpeechStyle } from './synthesizer.ts';
import type { Synthesizer } from './synthesizer.ts';
import {
  ActiveUtterance,
  type Utterance,
} from './utterance.ts';

export interface SayOptions {
  style?: SpeechStyle;
}

/** Executes speech; it does not decide wording or segmentation. */
export interface Voice {
  say(text: string, options?: SayOptions): Utterance;
  interrupt(): void;
}

export interface CoreVoiceOptions {
  synthesizer: Synthesizer;
  stage: StageLink;
  createId?: () => string;
}

export class VoiceBusyError extends Error {
  constructor() {
    super('Cannot start an utterance while another utterance is active.');
    this.name = 'VoiceBusyError';
  }
}

export class EmptyAudioStreamError extends Error {
  constructor() {
    super('The synthesizer produced no audio.');
    this.name = 'EmptyAudioStreamError';
  }
}

export class AudioFormatChangedError extends Error {
  constructor() {
    super('The synthesizer changed audio format within one utterance.');
    this.name = 'AudioFormatChangedError';
  }
}

export class StageDisconnectedError extends Error {
  override readonly cause?: unknown;

  constructor(cause?: unknown) {
    super('Stage disconnected before the utterance completed.');
    this.name = 'StageDisconnectedError';
    this.cause = cause;
  }
}

type PlaybackOutcome = 'played' | 'interrupted' | 'disconnected';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface ActiveSpeech {
  readonly utterance: ActiveUtterance;
  readonly streamId: string;
  readonly playback: Deferred<PlaybackOutcome>;
  speakerStarted: boolean;
  disconnectReason?: unknown;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value) {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(value);
    },
  };
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function sameFormat(frame: AudioFrame, format: AudioFormat): boolean {
  return (
    frame.sampleRate === format.sampleRate && frame.channels === format.channels
  );
}

/**
 * Executes one observable speech action at a time.
 *
 * Playback acknowledgements are runtime-facing methods on this concrete class;
 * Agent tools only receive the narrow {@link Voice} interface.
 */
export class CoreVoice implements Voice {
  readonly #synthesizer: Synthesizer;
  readonly #stage: StageLink;
  readonly #createId: () => string;

  #active?: ActiveSpeech;

  constructor(options: CoreVoiceOptions) {
    this.#synthesizer = options.synthesizer;
    this.#stage = options.stage;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  say(text: string, options: SayOptions = {}): Utterance {
    if (text.trim().length === 0) {
      throw new TypeError('Utterance text must not be empty.');
    }

    if (this.#active) {
      throw new VoiceBusyError();
    }

    let active!: ActiveSpeech;
    const utterance = new ActiveUtterance(`utterance-${this.#createId()}`, {
      onInterrupt: () => {
        void this.#handleInterruption(active);
      },
    });

    active = {
      utterance,
      streamId: `audio-${this.#createId()}`,
      playback: deferred<PlaybackOutcome>(),
      speakerStarted: false,
    };
    this.#active = active;

    void this.#run(active, text, options.style);
    return utterance;
  }

  interrupt(): void {
    this.#active?.utterance.interrupt();
  }

  playbackFinished(streamId: string): void {
    const active = this.#active;
    if (
      !active ||
      active.streamId !== streamId ||
      !active.utterance.isPending
    ) {
      return;
    }

    if (!active.utterance.beginFinish()) {
      return;
    }
    active.playback.resolve('played');
  }

  stageDisconnected(reason?: unknown): void {
    const active = this.#active;
    if (!active) {
      return;
    }

    active.disconnectReason = reason;
    active.playback.resolve('disconnected');

    if (active.utterance.isPending) {
      void this.#fail(active, new StageDisconnectedError(reason));
    }
  }

  async #run(
    active: ActiveSpeech,
    text: string,
    style?: SpeechStyle,
  ): Promise<void> {
    try {
      await this.#stage.send({
        type: 'utterance.start',
        utteranceId: active.utterance.id,
      });

      let format: AudioFormat | undefined;

      for await (const frame of this.#synthesizer.synthesize(
        text,
        style,
        active.utterance.signal,
      )) {
        if (!active.utterance.isPending) {
          return;
        }

        validateAudioFrame(frame);
        if (frame.data.length === 0) {
          continue;
        }

        if (!format) {
          format = {
            streamId: active.streamId,
            sampleRate: frame.sampleRate,
            channels: frame.channels,
            encoding: 'f32le',
          };
          active.speakerStarted = true;
          await this.#stage.send({
            type: 'speaker.start',
            utteranceId: active.utterance.id,
            format,
          });
        } else if (!sameFormat(frame, format)) {
          throw new AudioFormatChangedError();
        }

        if (!active.utterance.isPending) {
          return;
        }
        await this.#stage.sendAudio(encodeFloat32LE(frame.data));
      }

      if (!active.utterance.isPending) {
        return;
      }
      if (!format) {
        throw new EmptyAudioStreamError();
      }

      await this.#stage.send({
        type: 'speaker.stop',
        streamId: active.streamId,
        reason: 'completed',
      });

      const playback = await active.playback.promise;

      if (playback === 'disconnected') {
        throw new StageDisconnectedError(active.disconnectReason);
      }
      if (playback === 'interrupted') {
        return;
      }
      if (!active.utterance.isFinishing) {
        return;
      }

      await this.#sendBestEffort({
        type: 'utterance.end',
        utteranceId: active.utterance.id,
        status: 'finished',
      });
      this.#clear(active);
      active.utterance.finish();
    } catch (error) {
      if (active.utterance.isInterrupting || active.utterance.state === 'interrupted') {
        return;
      }
      await this.#fail(active, error);
    }
  }

  async #handleInterruption(active: ActiveSpeech): Promise<void> {
    if (!active.utterance.isInterrupting) {
      return;
    }
    active.playback.resolve('interrupted');

    if (active.speakerStarted) {
      await this.#sendBestEffort({
        type: 'speaker.stop',
        streamId: active.streamId,
        reason: 'interrupted',
      });
    }
    await this.#sendBestEffort({
      type: 'utterance.end',
      utteranceId: active.utterance.id,
      status: 'interrupted',
    });

    this.#clear(active);
    active.utterance.finishInterruption();
  }

  async #fail(active: ActiveSpeech, reason: unknown): Promise<void> {
    const error = asError(reason);
    if (!active.utterance.beginFailure(error)) {
      return;
    }

    if (active.speakerStarted) {
      await this.#sendBestEffort({
        type: 'speaker.stop',
        streamId: active.streamId,
        reason: 'failed',
      });
    }
    await this.#sendBestEffort({
      type: 'error',
      message: error.message,
      recoverable: true,
    });
    await this.#sendBestEffort({
      type: 'utterance.end',
      utteranceId: active.utterance.id,
      status: 'failed',
    });

    this.#clear(active);
    active.utterance.finishFailure(error);
  }

  #clear(active: ActiveSpeech): void {
    if (this.#active === active) {
      this.#active = undefined;
    }
  }

  async #sendBestEffort(
    message: Parameters<StageLink['send']>[0],
  ): Promise<void> {
    try {
      await this.#stage.send(message);
    } catch {
      // The primary action result remains authoritative during cleanup.
    }
  }
}
