import type { Host } from './host/host.ts';
import type { Memory } from './memory/memory.ts';
import type { Voice } from './voice/voice.ts';

/** Dependencies available to Agents SDK tools through RunContext. */
export interface AmadeusContext {
  voice: Voice;
  memory: Memory;
  host: Host;
}
