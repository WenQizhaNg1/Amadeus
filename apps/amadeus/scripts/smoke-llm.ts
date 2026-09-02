import { OpenAIProvider, Runner } from '@openai/agents';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agent } from '../src/agent.ts';
import { AmadeusRuntime } from '../src/amadeus.ts';
import type { AmadeusContext } from '../src/context.ts';
import { SQLiteSession } from '../src/conversation/sqlite-session.ts';
import { openDatabase } from '../src/storage/sqlite.ts';
import type { Voice } from '../src/voice/voice.ts';

function requiredEnvironment(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const apiKey = requiredEnvironment('DEEPSEEK_API_KEY');
const baseURL = Bun.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com';
const model = requiredEnvironment('DEEPSEEK_MODEL');
const phrase = `amadeus-${crypto.randomUUID().slice(0, 8)}`;
const spoken: string[] = [];

const voice: Voice = {
  say(text) {
    spoken.push(text);
    return {
      id: crypto.randomUUID(),
      interrupt() {},
      done: Promise.resolve({ status: 'finished' }),
    };
  },
  interrupt() {},
};

const context: AmadeusContext = {
  voice,
  memory: {
    async recall() {
      return [];
    },
    async remember(item) {
      return {
        ...item,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
    },
    async forget() {},
  },
};

const provider = new OpenAIProvider({
  apiKey,
  baseURL,
  useResponses: true,
});
const runner = new Runner({
  modelProvider: provider,
  tracingDisabled: true,
});
const configuredAgent = agent.clone({ model });
const directory = mkdtempSync(join(tmpdir(), 'amadeus-llm-smoke-'));
const databasePath = join(directory, 'amadeus.db');
let database: Database | undefined;

try {
  database = openDatabase(databasePath);
  const firstSession = new SQLiteSession(database, 'llm-smoke');
  const firstRuntime = new AmadeusRuntime({
    runner,
    agent: configuredAgent,
    context,
    session: firstSession,
  });
  await firstRuntime.turn(
    `Remember the temporary phrase "${phrase}" in this conversation. ` +
      'Call say exactly once with the word "Stored", then complete the turn.',
  );
  if (spoken.length !== 1 || spoken[0] !== 'Stored') {
    throw new Error('The first turn did not speak exactly "Stored" once.');
  }
  const firstTurnItems = (await firstSession.getItems()).length;
  database.close();
  database = undefined;

  const spokenBeforeRecall = spoken.length;
  database = openDatabase(databasePath);
  const reopenedSession = new SQLiteSession(database, 'llm-smoke');
  const reopenedRuntime = new AmadeusRuntime({
    runner,
    agent: configuredAgent,
    context,
    session: reopenedSession,
  });
  await reopenedRuntime.turn(
    'Recall the temporary phrase from the previous turn. ' +
      'Call say exactly once with only that phrase, then complete the turn.',
  );

  const recalledSpeech = spoken.slice(spokenBeforeRecall);
  if (recalledSpeech.length !== 1 || recalledSpeech[0] !== phrase) {
    throw new Error(
      'The second turn did not speak the exact persisted phrase once.',
    );
  }
  const finalItems = (await reopenedSession.getItems()).length;
  if (finalItems <= firstTurnItems) {
    throw new Error('The second turn did not append persisted session history.');
  }

  console.log(
    JSON.stringify({
      ok: true,
      model,
      firstTurnItems,
      finalItems,
      recalledSpeech,
    }),
  );
} finally {
  database?.close();
  await provider.close();
  rmSync(directory, { recursive: true, force: true });
}
