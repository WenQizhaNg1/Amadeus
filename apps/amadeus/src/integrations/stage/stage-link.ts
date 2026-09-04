import type { AmadeusToStageMessage } from '@amadeus/stage-protocol';

/** Core-facing side of the local Stage connection. */
export interface StageLink {
  send(message: AmadeusToStageMessage): void | Promise<void>;
  sendAudio(frame: Uint8Array): void | Promise<void>;
}
