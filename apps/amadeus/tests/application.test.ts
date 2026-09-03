import { describe, expect, test } from 'bun:test';
import type { AgentInputItem, Model } from '@openai/agents';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { start, type Amadeus } from '../src/application.ts';
import { ConversationArchivedError } from '../src/conversation/conversation.ts';
import { ConversationSession } from '../src/conversation/session.ts';
import { closeDatabase, openDatabase } from '../src/storage/database.ts';
import type { Voice } from '../src/voice/voice.ts';

const model = {
  async getResponse() {
    throw new Error('Model should not run in this test.');
  },
  async *getStreamedResponse() {
    throw new Error('Model should not run in this test.');
  },
} as Model;

const voice: Voice = {
  say() {
    throw new Error('Voice should not run in this test.');
  },
  interrupt() {},
};

const identityPath = join(import.meta.dir, '..', 'identity.md');

async function openApp(databasePath: string): Promise<Amadeus> {
  return await start({
    model,
    voice,
    databasePath,
    identityPath,
    contextChars: 1_000,
  });
}

describe('Amadeus application', () => {
  test('creates a first conversation and resumes the latest one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-app-'));
    const path = join(directory, 'amadeus.db');
    let app: Amadeus | undefined;
    try {
      app = await openApp(path);
      const first = app.conversation;
      const second = await app.create();
      expect(second.id).not.toBe(first.id);
      expect(app.conversation).toEqual(second);
      await app.close();

      app = await openApp(path);
      expect(app.conversation.id).toBe(second.id);
      expect(await app.list()).toHaveLength(2);
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('renames, archives, restores and opens conversations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-app-'));
    const path = join(directory, 'amadeus.db');
    let app: Amadeus | undefined;
    try {
      app = await openApp(path);
      const first = app.conversation;
      await app.rename(first.id, ' First ');
      expect(app.conversation.title).toBe('First');

      await app.archive(first.id);
      const replacement = app.conversation;
      expect(replacement.id).not.toBe(first.id);
      expect(await app.list()).toEqual([replacement]);

      await expect(app.open(first.id)).rejects.toBeInstanceOf(
        ConversationArchivedError,
      );
      await app.unarchive(first.id);
      expect((await app.open(first.id)).id).toBe(first.id);
      expect(app.conversation.title).toBe('First');

      const all = await app.list({ includeArchived: true });
      expect(all).toHaveLength(2);
      expect(all.every(({ archivedAt }) => archivedAt === undefined)).toBe(true);
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('closes idempotently and rejects later work', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-app-'));
    const path = join(directory, 'amadeus.db');
    try {
      const app = await openApp(path);
      const firstClose = app.close();
      expect(app.close()).toBe(firstClose);
      await firstClose;

      expect(() => app.create()).toThrow('Amadeus is closed.');
      expect(() => app.turn('hello')).toThrow('Amadeus is closed.');
      await expect(app.list()).rejects.toThrow('Amadeus is closed.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a turn while a conversation operation is pending', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-app-'));
    const path = join(directory, 'amadeus.db');
    let app: Amadeus | undefined;
    try {
      app = await openApp(path);
      const creation = app.create();

      await expect(app.turn('too early')).rejects.toThrow(
        'Conversation operation in progress.',
      );
      await expect(app.wake({ type: 'startup' })).resolves.toBeUndefined();
      await creation;
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('reads limited history without hiding archived conversations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-app-'));
    const path = join(directory, 'amadeus.db');
    let app: Amadeus | undefined;
    try {
      app = await openApp(path);
      const id = app.conversation.id;
      const items: AgentInputItem[] = [
        { role: 'user', content: 'one' },
        {
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'two' }],
        },
      ];
      const database = await openDatabase(path);
      try {
        await new ConversationSession(database, id).addItems(items);
      } finally {
        closeDatabase(database);
      }

      expect(await app.history(id)).toEqual(items);
      expect(await app.history(id, 1)).toEqual(items.slice(1));

      await app.archive(id);
      expect(await app.history(id)).toHaveLength(2);
      const count = (await app.list({ includeArchived: true })).length;
      await expect(app.history('missing')).rejects.toThrow(
        'Conversation not found: missing',
      );
      expect(await app.list({ includeArchived: true })).toHaveLength(count);
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
