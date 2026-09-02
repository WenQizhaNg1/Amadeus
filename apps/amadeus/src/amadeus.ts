import type { AgentInputItem, Runner, Session } from '@openai/agents';

import type { Activity } from './activity.ts';
import { agent, type AmadeusAgent } from './agent.ts';
import type { AmadeusContext } from './context.ts';
import type { Signal } from './signal.ts';
import type { Utterance } from './voice/utterance.ts';
import type { Voice } from './voice/voice.ts';

/** The thin, persistent runtime that coordinates one interaction at a time. */
export interface Amadeus {
  readonly activity: Activity;

  turn(text: string): Promise<void>;
  wake(signal: Signal): Promise<void>;
  interrupt(): void;
}

/** The two inputs that can start an AMADEUS turn. */
export type TurnInput =
  | { type: 'user'; text: string }
  | { type: 'signal'; signal: Signal };

export interface AmadeusRuntimeOptions {
  runner: Runner;
  context: AmadeusContext;
  session: Session;
  agent?: AmadeusAgent;
  onActivity?: (activity: Activity) => void | Promise<void>;
}

function signalInput(signal: Signal): AgentInputItem[] {
  return [
    {
      role: 'system',
      content: `Lifecycle signal: ${JSON.stringify(signal)}`,
    },
  ];
}

/**
 * Coordinates SDK runs without introducing another orchestration framework.
 *
 * User turns preempt older work. Signals only run while the runtime is idle.
 */
export class AmadeusRuntime implements Amadeus {
  readonly #agent: AmadeusAgent;
  readonly #runner: Runner;
  readonly #session: Session;
  readonly #onActivity?: AmadeusRuntimeOptions['onActivity'];
  readonly #voice: Voice;
  readonly #context: AmadeusContext;

  #activity: Activity = 'idle';
  #active?: AbortController;
  #utterance?: Utterance;
  #handoff: Promise<void> = Promise.resolve();
  #activityNotifications: Promise<void> = Promise.resolve();
  #generation = 0;
  #reserved = false;

  constructor(options: AmadeusRuntimeOptions) {
    this.#agent = options.agent ?? agent;
    this.#runner = options.runner;
    this.#session = options.session;
    this.#onActivity = options.onActivity;

    const voice = options.context.voice;
    this.#voice = {
      say: (text, sayOptions) => {
        const utterance = voice.say(text, sayOptions);
        this.#utterance = utterance;
        const owner = this.#active;
        this.#setActivity('speaking');

        const restoreThinking = () => {
          if (this.#utterance === utterance) {
            this.#utterance = undefined;
          }
          if (owner && this.#active === owner && !owner.signal.aborted) {
            this.#setActivity('thinking');
          }
        };
        void utterance.done.then(restoreThinking, restoreThinking);

        return utterance;
      },
      interrupt: () => voice.interrupt(),
    };
    this.#context = { ...options.context, voice: this.#voice };
  }

  get activity(): Activity {
    return this.#activity;
  }

  turn(text: string): Promise<void> {
    const input = text.trim();
    if (!input) {
      return Promise.reject(new TypeError('Turn text must not be empty.'));
    }

    const generation = ++this.#generation;
    this.#reserved = true;
    this.#cancelActive();
    return this.#enqueue(generation, input);
  }

  wake(signal: Signal): Promise<void> {
    if (this.#reserved || this.#active || this.#activity !== 'idle') {
      return Promise.resolve();
    }

    const generation = ++this.#generation;
    this.#reserved = true;
    return this.#enqueue(generation, signalInput(signal));
  }

  interrupt(): void {
    this.#generation += 1;
    this.#reserved = false;
    this.#cancelActive();

    if (!this.#active) {
      this.#setActivity('idle');
    }
  }

  #enqueue(generation: number, input: string | AgentInputItem[]): Promise<void> {
    const operation = this.#handoff.then(async () => {
      if (generation !== this.#generation) {
        return;
      }
      await this.#run(input, generation);
    });

    this.#handoff = operation.catch(() => {});
    return operation;
  }

  async #run(
    input: string | AgentInputItem[],
    generation: number,
  ): Promise<void> {
    const controller = new AbortController();
    this.#active = controller;
    this.#setActivity('thinking');

    try {
      const result = await this.#runner.run(this.#agent, input, {
        context: this.#context,
        session: this.#session,
        stream: true,
        signal: controller.signal,
      });
      await result.completed;

      if (result.error != null) {
        throw result.error;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (controller.signal.aborted) {
        await this.#waitForUtterance();
      }
      if (this.#active === controller) {
        this.#active = undefined;
      }
      if (generation === this.#generation) {
        this.#reserved = false;
        this.#setActivity('idle');
      } else if (!this.#reserved && !this.#active) {
        this.#setActivity('idle');
      }
    }
  }

  #cancelActive(): void {
    if (!this.#active) {
      return;
    }
    this.#voice.interrupt();
    this.#active.abort(new Error('Amadeus turn interrupted.'));
  }

  async #waitForUtterance(): Promise<void> {
    try {
      await this.#utterance?.done;
    } catch {
      // A failed utterance is still settled and no longer blocks handoff.
    }
  }

  #setActivity(activity: Activity): void {
    if (this.#activity === activity) {
      return;
    }
    this.#activity = activity;

    if (this.#onActivity) {
      this.#activityNotifications = this.#activityNotifications
        .then(() => this.#onActivity?.(activity))
        .catch(() => {
          // Activity observers must not control the Agent run lifecycle.
        });
    }
  }
}
