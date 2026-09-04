import type {
  AmadeusToStageMessage,
  StageProtocolErrorCode,
  StageToAmadeusMessage,
} from '@amadeus/stage-protocol';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting-state'
  | 'ready'
  | 'reconnecting';

export interface StageTransportFailure {
  code:
    | Extract<
        StageProtocolErrorCode,
        'protocol.invalid_message' | 'protocol.unsupported_version'
      >
    | 'stage.transport_failed';
  message: string;
  recoverable: boolean;
}

export interface StageTransportObserver {
  onConnectionChange(status: ConnectionStatus): void;
  onMessage(message: AmadeusToStageMessage): void;
  onError(error: StageTransportFailure): void;
}

export interface StageTransport {
  readonly label: string;

  connect(observer: StageTransportObserver): () => void;
  send(message: StageToAmadeusMessage): void | Promise<void>;
}
