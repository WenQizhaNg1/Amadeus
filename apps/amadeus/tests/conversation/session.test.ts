import { describe, expect, test } from 'bun:test';
import type { AgentInputItem } from '@openai/agents';
import { asc, eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeDatabase,
  openDatabase,
} from '../../src/storage/database.ts';
import { conversationItems, sessions } from '../../src/storage/schema.ts';
import { ConversationSession } from '../../src/conversation/session.ts';

function user(text: string): AgentInputItem {
  return { role: 'user', content: text };
}

describe('ConversationSession', () => {
  test('uses a stable default ID and creates its session row', async () => {
    const database = await openDatabase(':memory:');
    try {
      const session = new ConversationSession(database, undefined, () => 123);

      expect(await session.getSessionId()).toBe('primary');
      expect(
        (
          await database
            .select({ id: sessions.id, createdAt: sessions.createdAt })
            .from(sessions)
        )[0],
      ).toEqual({ id: 'primary', createdAt: 123 });
    } finally {
      closeDatabase(database);
    }
  });

  test('appends batches in order and returns the newest limit chronologically', async () => {
    const database = await openDatabase(':memory:');
    try {
      const session = new ConversationSession(database, 'test');
      const items = [user('one'), user('two'), user('three')];

      await session.addItems(items.slice(0, 2));
      await session.addItems(items.slice(2));

      expect(await session.getItems()).toEqual(items);
      expect(await session.getItems(2)).toEqual(items.slice(1));
      expect(await session.getItems(10)).toEqual(items);
      expect(await session.getItems(0)).toEqual([]);
    } finally {
      closeDatabase(database);
    }
  });

  test('updates conversation activity when items are appended', async () => {
    const database = await openDatabase(':memory:');
    const times = [100, 200];
    try {
      const session = new ConversationSession(
        database,
        'test',
        () => times.shift() ?? 999,
      );

      await session.addItems([user('one'), user('two')]);

      expect(
        (
          await database
            .select({
              createdAt: sessions.createdAt,
              updatedAt: sessions.updatedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, 'test'))
        )[0],
      ).toEqual({ createdAt: 100, updatedAt: 200 });
      expect(
        await database
          .selectDistinct({ createdAt: conversationItems.createdAt })
          .from(conversationItems)
          .where(eq(conversationItems.sessionId, 'test')),
      ).toEqual([{ createdAt: 200 }]);
    } finally {
      closeDatabase(database);
    }
  });

  test('rejects invalid limits', async () => {
    const database = await openDatabase(':memory:');
    try {
      const session = new ConversationSession(database);

      await expect(session.getItems(-1)).rejects.toBeInstanceOf(RangeError);
      await expect(session.getItems(1.5)).rejects.toBeInstanceOf(RangeError);
      await expect(session.getItems(Number.NaN)).rejects.toBeInstanceOf(
        RangeError,
      );
    } finally {
      closeDatabase(database);
    }
  });

  test('serializes a batch before writing any of it', async () => {
    const database = await openDatabase(':memory:');
    try {
      const session = new ConversationSession(database);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      await expect(
        session.addItems([user('valid'), cyclic as AgentInputItem]),
      ).rejects.toBeInstanceOf(TypeError);
      expect(await session.getItems()).toEqual([]);

      await session.addItems([]);
      expect(await session.getItems()).toEqual([]);
    } finally {
      closeDatabase(database);
    }
  });

  test('pops the newest item and returns undefined when empty', async () => {
    const database = await openDatabase(':memory:');
    try {
      const session = new ConversationSession(database);
      await session.addItems([user('one'), user('two')]);

      expect(await session.popItem()).toEqual(user('two'));
      expect(await session.getItems()).toEqual([user('one')]);
      expect(await session.popItem()).toEqual(user('one'));
      expect(await session.popItem()).toBeUndefined();
    } finally {
      closeDatabase(database);
    }
  });

  test('clears only its own history and retains both session identities', async () => {
    const database = await openDatabase(':memory:');
    try {
      const first = new ConversationSession(database, 'first');
      const second = new ConversationSession(database, 'second');
      await first.addItems([user('first item')]);
      await second.addItems([user('second item')]);

      await first.clearSession();

      expect(await first.getItems()).toEqual([]);
      expect(await second.getItems()).toEqual([user('second item')]);
      const storedSessions = await database
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(asc(sessions.id));
      expect(storedSessions.map(({ id }) => id)).toEqual(['first', 'second']);
    } finally {
      closeDatabase(database);
    }
  });

  test('retains conversation history after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-session-'));
    const path = join(directory, 'amadeus.db');

    try {
      const firstDatabase = await openDatabase(path);
      const firstSession = new ConversationSession(firstDatabase, 'persistent');
      await firstSession.addItems([user('remember me')]);
      closeDatabase(firstDatabase);

      const reopenedDatabase = await openDatabase(path);
      try {
        const reopenedSession = new ConversationSession(
          reopenedDatabase,
          'persistent',
        );
        expect(await reopenedSession.getItems()).toEqual([
          user('remember me'),
        ]);
      } finally {
        closeDatabase(reopenedDatabase);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an empty session ID', async () => {
    const database = await openDatabase(':memory:');
    try {
      expect(() => new ConversationSession(database, '   ')).toThrow(TypeError);
    } finally {
      closeDatabase(database);
    }
  });
});
