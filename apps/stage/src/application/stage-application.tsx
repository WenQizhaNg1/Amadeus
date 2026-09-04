import type { StageTransport } from '../transport/stage-transport.ts';
import { StageScreen } from '../ui/layout/stage-screen.tsx';
import { useStageApplication } from './use-stage-application.ts';

interface StageApplicationProps {
  transport: StageTransport;
}

export function StageApplication({ transport }: StageApplicationProps) {
  const application = useStageApplication(transport);

  return <StageScreen {...application} />;
}
