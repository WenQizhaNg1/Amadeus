import type { Voice } from './voice/voice.ts';

/** Dependencies available to Agents SDK tools through RunContext. */
export interface AmadeusContext {
  voice: Voice;
}
