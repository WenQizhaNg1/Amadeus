import type { AmadeusToStageMessage } from '@amadeus/stage-protocol';

import {
  VoiceBusyError,
  type SayOptions,
  type Voice,
} from '../../voice/voice.ts';
import { ActiveUtterance, type Utterance } from '../../voice/utterance.ts';
import type { StageLink } from './stage-link.ts';

export interface StageTextVoiceOptions {
  stage: StageLink;
  writeLine?: (text: string) => void;
  createId?: () => string;
}

/** Presents text to Stage until the real synthesizer is connected. */
export class StageTextVoice implements Voice {
  readonly #stage: StageLink;
  readonly #writeLine?: (text: string) => void;
  readonly #createId: () => string;

  #active?: ActiveUtterance;

  constructor(options: StageTextVoiceOptions) {
    this.#stage = options.stage;
    this.#writeLine = options.writeLine;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  say(text: string, _options: SayOptions = {}): Utterance {
    if (!text.trim()) {
      throw new TypeError('Utterance text must not be empty.');
    }
    if (this.#active) {
      throw new VoiceBusyError();
    }

    const utterance = new ActiveUtterance(`utterance-${this.#createId()}`, {
      onInterrupt: () => {
        const active = this.#active;
        if (active) {
          void this.#finishInterruption(active);
        }
      },
    });
    this.#writeLine?.(text);
    this.#active = utterance;
    void this.#present(utterance, text);
    return utterance;
  }

  interrupt(): void {
    this.#active?.interrupt();
  }

  stageDisconnected(): void {
    this.interrupt();
  }

  async #present(utterance: ActiveUtterance, text: string): Promise<void> {
    await this.#sendBestEffort({
      type: 'utterance.start',
      utteranceId: utterance.id,
      text,
    });
    if (!utterance.beginFinish()) {
      return;
    }
    await this.#sendBestEffort({
      type: 'utterance.end',
      utteranceId: utterance.id,
      status: 'finished',
    });
    this.#clear(utterance);
    utterance.finish();
  }

  async #finishInterruption(utterance: ActiveUtterance): Promise<void> {
    await this.#sendBestEffort({
      type: 'utterance.end',
      utteranceId: utterance.id,
      status: 'interrupted',
    });
    this.#clear(utterance);
    utterance.finishInterruption();
  }

  #clear(utterance: ActiveUtterance): void {
    if (this.#active === utterance) {
      this.#active = undefined;
    }
  }

  async #sendBestEffort(message: AmadeusToStageMessage): Promise<void> {
    try {
      await this.#stage.send(message);
    } catch {
      // Console output remains available while Stage is disconnected.
    }
  }
}
