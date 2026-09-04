import { OpenAIProvider } from '@openai/agents';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { start, type Amadeus } from './application/application.ts';
import { StageGateway } from './integrations/stage/stage-gateway.ts';
import {
  serveStage,
  type StageServer,
} from './integrations/stage/stage-server.ts';
import { StageTextVoice } from './integrations/stage/stage-text-voice.ts';
import { ConsoleAgentRunObserver } from './observability/console-agent-run-observer.ts';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface SignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

interface Closable {
  close(): Promise<void>;
}

const repositoryRoot = resolve(import.meta.dir, '..', '..', '..');

export const DEFAULT_DATABASE_PATH = resolve(
  repositoryRoot,
  'data',
  'amadeus.db',
);

export const DEFAULT_ONTOLOGY_PATH = resolve(
  repositoryRoot,
  'data',
  'ontology.json',
);

export const DEFAULT_STAGE_STATIC_ROOT = resolve(
  repositoryRoot,
  'apps',
  'stage',
  'dist',
);

export function resolveRepositoryPath(
  value: string | undefined,
  fallback: string,
): string {
  const path = value?.trim();
  return path ? resolve(repositoryRoot, path) : fallback;
}

function requiredEnvironment(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function contextChars(): number {
  const value = Number(Bun.env.AMADEUS_CONTEXT_CHARS?.trim() || '48000');
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('AMADEUS_CONTEXT_CHARS must be a non-negative integer.');
  }
  return value;
}

function stagePort(): number {
  const value = Number(Bun.env.AMADEUS_STAGE_PORT?.trim() || '3000');
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('AMADEUS_STAGE_PORT must be an integer from 1 to 65535.');
  }
  return value;
}

export async function closeResources(
  app: Closable | undefined,
  provider: Closable,
): Promise<void> {
  try {
    await app?.close();
  } finally {
    await provider.close();
  }
}

export function installShutdown(
  shutdown: () => Promise<void>,
  source: SignalSource = process,
): () => void {
  const handle = () => {
    void shutdown().catch(() => {
      // main() awaits the same shutdown promise and reports the error once.
    });
  };
  source.once('SIGINT', handle);
  source.once('SIGTERM', handle);
  return () => {
    source.off('SIGINT', handle);
    source.off('SIGTERM', handle);
  };
}

export async function main(): Promise<void> {
  const provider = new OpenAIProvider({
    apiKey: requiredEnvironment('LLM_API_KEY'),
    baseURL: requiredEnvironment('LLM_BASE_URL'),
    useResponses: true,
  });
  const model = await provider.getModel(requiredEnvironment('LLM_MODEL'));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let app: Amadeus | undefined;
  let stageServer: StageServer | undefined;
  let closing: Promise<void> | undefined;
  let removeShutdown = () => {};

  const shutdown = (): Promise<void> => {
    if (!closing) {
      input.close();
      closing = (async () => {
        try {
          await stageServer?.stop();
        } finally {
          await closeResources(app, provider);
        }
      })();
    }
    return closing;
  };
  try {
    let voice: StageTextVoice | undefined;
    const application = (): Amadeus => {
      if (!app) {
        throw new Error('AMADEUS application is not ready.');
      }
      return app;
    };
    const gateway = new StageGateway({
      getActivity: () => application().activity,
      onInput: (text) => application().turn(text),
      onInterrupt: () => application().interrupt(),
      onDisconnect: () => voice?.stageDisconnected(),
    });
    voice = new StageTextVoice({
      stage: gateway,
      writeLine: (text) => process.stdout.write(`${text}\n`),
    });

    app = await start({
      model,
      voice,
      databasePath: resolveRepositoryPath(
        Bun.env.AMADEUS_DATABASE_PATH,
        DEFAULT_DATABASE_PATH,
      ),
      identityPath: resolveRepositoryPath(
        Bun.env.AMADEUS_IDENTITY_PATH,
        resolve(import.meta.dir, '..', 'identity.md'),
      ),
      ontologyPath: resolveRepositoryPath(
        Bun.env.AMADEUS_ONTOLOGY_PATH,
        DEFAULT_ONTOLOGY_PATH,
      ),
      contextChars: contextChars(),
      onActivity: (activity) => gateway.notifyActivity(activity),
      observer: new ConsoleAgentRunObserver(),
    });
    stageServer = serveStage({
      gateway,
      hostname: Bun.env.AMADEUS_STAGE_HOST?.trim() || '127.0.0.1',
      port: stagePort(),
      staticRoot: resolveRepositoryPath(
        Bun.env.AMADEUS_STAGE_STATIC_ROOT,
        DEFAULT_STAGE_STATIC_ROOT,
      ),
    });
    process.stderr.write(
      `Stage server listening at http://${stageServer.hostname}:${stageServer.port}\n`,
    );
    removeShutdown = installShutdown(shutdown);

    await app.wake({ type: 'startup' });
    for await (const line of input) {
      if (!line.trim()) {
        continue;
      }
      try {
        await app.turn(line);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    removeShutdown();
    await shutdown();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
