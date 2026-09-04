import { OpenAIProvider } from '@openai/agents';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { start, type Amadeus } from '../src/application/application.ts';
import { ConversationSession } from '../src/conversation/session.ts';
import {
  closeDatabase,
  openDatabase,
} from '../src/storage/database.ts';
import type { Voice } from '../src/voice/voice.ts';

function requiredEnvironment(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function itemCount(databasePath: string, id: string): Promise<number> {
  const database = await openDatabase(databasePath);
  try {
    return (await new ConversationSession(database, id).getItems()).length;
  } finally {
    await closeDatabase(database);
  }
}

const provider = new OpenAIProvider({
  apiKey: requiredEnvironment('LLM_API_KEY'),
  baseURL: requiredEnvironment('LLM_BASE_URL'),
  useResponses: true,
});
const modelName = requiredEnvironment('LLM_MODEL');
const model = await provider.getModel(modelName);
const phrase = `amadeus-${crypto.randomUUID().slice(0, 8)}`;
const spoken: string[] = [];
const directory = mkdtempSync(join(tmpdir(), 'amadeus-llm-smoke-'));
const databasePath = join(directory, 'amadeus.db');
const identityPath = join(import.meta.dir, '..', 'identity.md');
const ontologyPath = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'data',
  'ontology.json',
);
let app: Amadeus | undefined;

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

try {
  app = await start({
    model,
    voice,
    databasePath,
    identityPath,
    ontologyPath,
    contextChars: 48_000,
  });
  const conversationId = app.conversation.id;
  await app.turn(
    `Remember the temporary phrase "${phrase}" in this conversation. ` +
      'Call say exactly once with the word "Stored", then complete the turn.',
  );
  if (spoken.length !== 1 || spoken[0] !== 'Stored') {
    throw new Error('The first turn did not speak exactly "Stored" once.');
  }
  await app.close();
  app = undefined;
  const firstTurnItems = await itemCount(databasePath, conversationId);

  const spokenBeforeRecall = spoken.length;
  app = await start({
    model,
    voice,
    databasePath,
    identityPath,
    ontologyPath,
    contextChars: 48_000,
  });
  if (app.conversation.id !== conversationId) {
    throw new Error('The application did not resume the previous conversation.');
  }
  await app.turn(
    'Recall the temporary phrase from the previous turn. ' +
      'Call say exactly once with only that phrase, then complete the turn.',
  );

  const recalledSpeech = spoken.slice(spokenBeforeRecall);
  if (recalledSpeech.length !== 1 || recalledSpeech[0] !== phrase) {
    throw new Error(
      'The second turn did not speak the exact persisted phrase once.',
    );
  }
  await app.close();
  app = undefined;
  const finalItems = await itemCount(databasePath, conversationId);
  if (finalItems <= firstTurnItems) {
    throw new Error('The second turn did not append persisted session history.');
  }

  console.log(
    JSON.stringify({
      ok: true,
      model: modelName,
      conversationId,
      firstTurnItems,
      finalItems,
      recalledSpeech,
    }),
  );
} finally {
  await app?.close();
  await provider.close();
  rmSync(directory, { recursive: true, force: true });
}
