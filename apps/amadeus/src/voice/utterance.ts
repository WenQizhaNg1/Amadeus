export type UtteranceResult =
  | { status: 'finished' }
  | { status: 'interrupted' };

export type UtteranceState =
  | 'pending'
  | 'finishing'
  | 'interrupting'
  | 'failing'
  | 'finished'
  | 'interrupted'
  | 'failed';

export class UtteranceInterruptedError extends Error {
  constructor() {
    super('The utterance was interrupted.');
    this.name = 'UtteranceInterruptedError';
  }
}

/** One real, observable and interruptible speaking action. */
export interface Utterance {
  readonly id: string;
  readonly done: Promise<UtteranceResult>;

  interrupt(): void;
}

export interface ActiveUtteranceOptions {
  onInterrupt?: () => void;
}

/**
 * Runtime-owned implementation of an utterance.
 *
 * Agent-facing code only sees {@link Utterance}; completion methods remain on
 * this concrete class for Voice to coordinate synthesis and real playout.
 */
export class ActiveUtterance implements Utterance {
  readonly id: string;
  readonly done: Promise<UtteranceResult>;

  readonly #abortController = new AbortController();
  readonly #onInterrupt?: () => void;

  #state: UtteranceState = 'pending';
  #resolve!: (result: UtteranceResult) => void;
  #reject!: (reason: unknown) => void;

  constructor(id: string, options: ActiveUtteranceOptions = {}) {
    this.id = id;
    this.#onInterrupt = options.onInterrupt;
    this.done = new Promise<UtteranceResult>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get state(): UtteranceState {
    return this.#state;
  }

  get isPending(): boolean {
    return this.#state === 'pending';
  }

  get isFinishing(): boolean {
    return this.#state === 'finishing';
  }

  get isInterrupting(): boolean {
    return this.#state === 'interrupting';
  }

  interrupt(): void {
    if (this.#state !== 'pending') {
      return;
    }

    this.#state = 'interrupting';
    this.#abortController.abort(new UtteranceInterruptedError());
    this.#onInterrupt?.();
  }

  beginFinish(): boolean {
    if (this.#state !== 'pending') {
      return false;
    }

    this.#state = 'finishing';
    return true;
  }

  finish(): boolean {
    if (this.#state !== 'finishing') {
      return false;
    }

    this.#state = 'finished';
    this.#resolve({ status: 'finished' });
    return true;
  }

  finishInterruption(): boolean {
    if (this.#state !== 'interrupting') {
      return false;
    }

    this.#state = 'interrupted';
    this.#resolve({ status: 'interrupted' });
    return true;
  }

  beginFailure(reason: unknown): boolean {
    if (this.#state !== 'pending') {
      return false;
    }

    this.#state = 'failing';
    this.#abortController.abort(reason);
    return true;
  }

  finishFailure(reason: unknown): boolean {
    if (this.#state !== 'failing') {
      return false;
    }

    this.#state = 'failed';
    this.#reject(reason);
    return true;
  }
}
