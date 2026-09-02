import type { Signal } from '../signal.ts';

/** The two inputs that can start an AMADEUS turn. */
export type TurnInput =
  | { type: 'user'; text: string }
  | { type: 'signal'; signal: Signal };
