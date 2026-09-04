import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StageApplication } from './application/stage-application.tsx';
import { MockStageTransport } from './transport/mock-stage-transport.ts';
import './ui/styles/globals.css';

const root = document.querySelector('#root');
if (!root) {
  throw new Error('Stage root element was not found.');
}

const transport = new MockStageTransport();

createRoot(root).render(
  <StrictMode>
    <StageApplication transport={transport} />
  </StrictMode>,
);
