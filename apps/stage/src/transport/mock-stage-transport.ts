import {
  PROTOCOL_VERSION,
  type AmadeusToStageMessage,
  type StageToAmadeusMessage,
} from '@amadeus/stage-protocol';

import type {
  StageTransport,
  StageTransportObserver,
} from './stage-transport.ts';

export class MockStageTransport implements StageTransport {
  readonly label = 'Mock Transport';

  readonly #connectionTimers = new Set<ReturnType<typeof setTimeout>>();
  readonly #responseTimers = new Set<ReturnType<typeof setTimeout>>();

  #observer?: StageTransportObserver;
  #ready = false;
  #activeUtteranceId?: string;

  connect(observer: StageTransportObserver): () => void {
    if (this.#observer) {
      throw new Error('Mock Stage transport is already connected.');
    }

    this.#observer = observer;
    observer.onConnectionChange('connecting');
    this.#schedule(this.#connectionTimers, 180, () => {
      observer.onConnectionChange('awaiting-state');
    });
    this.#schedule(this.#connectionTimers, 420, () => {
      this.#ready = true;
      this.#emit({
        type: 'stage.state',
        protocolVersion: PROTOCOL_VERSION,
        activity: 'idle',
      });
    });

    return () => {
      if (this.#observer !== observer) {
        return;
      }
      this.#clear(this.#connectionTimers);
      this.#cancelResponse(false);
      this.#observer = undefined;
      this.#ready = false;
    };
  }

  send(message: StageToAmadeusMessage): void {
    if (!this.#observer || !this.#ready) {
      throw new Error('Mock Stage transport is not ready.');
    }

    switch (message.type) {
      case 'input.text':
        this.#respondToText(message.requestId, message.text);
        break;
      case 'user.interrupt':
        this.#cancelResponse(true);
        this.#emit({ type: 'activity', activity: 'idle' });
        break;
      case 'stage.ready':
      case 'mic.start':
      case 'mic.stop':
      case 'speaker.played':
        break;
    }
  }

  #respondToText(requestId: string, text: string): void {
    this.#cancelResponse(true);
    this.#emit({ type: 'input.accepted', requestId });
    this.#emit({ type: 'activity', activity: 'thinking' });

    const utteranceId = `mock-${requestId}`;
    this.#schedule(this.#responseTimers, 650, () => {
      this.#activeUtteranceId = utteranceId;
      this.#emit({ type: 'utterance.start', utteranceId, text });
      this.#emit({ type: 'activity', activity: 'speaking' });
    });
    this.#schedule(this.#responseTimers, 2_400, () => {
      if (this.#activeUtteranceId !== utteranceId) {
        return;
      }
      this.#activeUtteranceId = undefined;
      this.#emit({ type: 'utterance.end', utteranceId, status: 'finished' });
      this.#emit({ type: 'activity', activity: 'idle' });
    });
  }

  #cancelResponse(notify: boolean): void {
    this.#clear(this.#responseTimers);
    const utteranceId = this.#activeUtteranceId;
    this.#activeUtteranceId = undefined;
    if (notify && utteranceId) {
      this.#emit({
        type: 'utterance.end',
        utteranceId,
        status: 'interrupted',
      });
    }
  }

  #emit(message: AmadeusToStageMessage): void {
    this.#observer?.onMessage(message);
  }

  #schedule(
    timers: Set<ReturnType<typeof setTimeout>>,
    delay: number,
    callback: () => void,
  ): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  #clear(timers: Set<ReturnType<typeof setTimeout>>): void {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  }
}
