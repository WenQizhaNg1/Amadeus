import type {
  AmadeusToStageMessage,
  StageToAmadeusMessage,
} from '@amadeus/stage-protocol';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting-state'
  | 'ready'
  | 'reconnecting';

export interface StageTransportObserver {
  onConnectionChange(status: ConnectionStatus): void;
  onMessage(message: AmadeusToStageMessage): void;
}

export interface StageTransport {
  connect(observer: StageTransportObserver): () => void;
  send(message: StageToAmadeusMessage): void | Promise<void>;
}
