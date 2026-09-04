/** A bounded external change that may deserve an agent turn. */
export type Signal =
  | { type: 'startup' }
  | { type: 'idle'; forMs: number }
  | { type: 'network.changed'; online: boolean }
  | { type: 'timer'; name: string };
