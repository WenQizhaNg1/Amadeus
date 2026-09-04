import { OpenAIProvider } from '@openai/agents';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { start, type Amadeus } from './application/application.ts';
import type { Voice } from './voice/voice.ts';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface SignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

interface Closable {
  close(): Promise<void>;
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

function consoleVoice(): Voice {
  return {
    say(text) {
      process.stdout.write(`${text}\n`);
      return {
        id: crypto.randomUUID(),
        interrupt() {},
        done: Promise.resolve({ status: 'finished' }),
      };
    },
    interrupt() {},
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
  let closing: Promise<void> | undefined;
  let removeShutdown = () => {};

  const shutdown = (): Promise<void> => {
    if (!closing) {
      input.close();
      closing = closeResources(app, provider);
    }
    return closing;
  };
  try {
    app = await start({
      model,
      voice: consoleVoice(),
      databasePath: resolve(
        Bun.env.AMADEUS_DATABASE_PATH?.trim() || 'data/amadeus.db',
      ),
      identityPath: resolve(
        Bun.env.AMADEUS_IDENTITY_PATH?.trim() ||
          resolve(import.meta.dir, '..', 'identity.md'),
      ),
      ontologyPath: resolve(
        Bun.env.AMADEUS_ONTOLOGY_PATH?.trim() ||
          resolve(import.meta.dir, '..', 'ontology.json'),
      ),
      contextChars: contextChars(),
    });
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
