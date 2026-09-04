import { stageToAmadeusMessageSchema } from '@amadeus/stage-protocol';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { StageTransport } from '../transport/stage-transport.ts';
import {
  initialStageState,
  stageReducer,
  type StageError,
} from './stage-state.ts';

function transportError(error: unknown): StageError {
  return {
    code: 'stage.transport_failed',
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
  };
}

export function useStageApplication(transport: StageTransport) {
  const [state, dispatch] = useReducer(stageReducer, initialStageState);
  const disconnect = useRef<(() => void) | undefined>(undefined);

  useEffect(
    () => () => {
      disconnect.current?.();
      disconnect.current = undefined;
    },
    [],
  );

  const start = useCallback(() => {
    if (disconnect.current) {
      return;
    }

    try {
      disconnect.current = transport.connect({
        onConnectionChange(status) {
          dispatch({ type: 'connection.changed', status });
        },
        onMessage(message) {
          dispatch({ type: 'message.received', message });
        },
      });
      dispatch({ type: 'interaction.started' });
    } catch (error) {
      dispatch({ type: 'error.raised', error: transportError(error) });
    }
  }, [transport]);

  const send = useCallback(
    (message: Parameters<StageTransport['send']>[0]) => {
      void Promise.resolve()
        .then(() => transport.send(message))
        .catch((error: unknown) => {
          dispatch({ type: 'error.raised', error: transportError(error) });
        });
    },
    [transport],
  );

  const submitText = useCallback(
    (text: string): boolean => {
      if (state.connection !== 'ready' || state.pendingRequestId) {
        return false;
      }

      const requestId = `request-${crypto.randomUUID()}`;
      const result = stageToAmadeusMessageSchema.safeParse({
        type: 'input.text',
        requestId,
        text: text.trim(),
      });
      if (!result.success) {
        return false;
      }

      dispatch({ type: 'input.submitted', requestId });
      send(result.data);
      return true;
    },
    [send, state.connection, state.pendingRequestId],
  );

  const interrupt = useCallback(() => {
    if (state.connection === 'ready') {
      send({ type: 'user.interrupt' });
    }
  }, [send, state.connection]);

  const dismissError = useCallback(() => {
    dispatch({ type: 'error.dismissed' });
  }, []);

  return { state, start, submitText, interrupt, dismissError };
}
