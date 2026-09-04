import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StageApplication } from './application/stage-application.tsx';
import { MockStageTransport } from './transport/mock-stage-transport.ts';
import type { StageTransport } from './transport/stage-transport.ts';
import { WebSocketStageTransport } from './transport/websocket-stage-transport.ts';
import './ui/styles/globals.css';

const root = document.querySelector('#root');
if (!root) {
  throw new Error('Stage root element was not found.');
}

const useMockTransport = new URL(window.location.href).searchParams.has('mock');
const transport: StageTransport = useMockTransport
  ? new MockStageTransport()
  : new WebSocketStageTransport();

createRoot(root).render(
  <StrictMode>
    <StageApplication transport={transport} />
  </StrictMode>,
);
