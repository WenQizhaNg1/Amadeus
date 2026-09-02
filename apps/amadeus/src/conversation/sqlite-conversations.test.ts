import { describe, expect, test } from 'bun:test';

import { openDatabase } from '../storage/sqlite.ts';
import { ConversationNotFoundError } from './conversation.ts';
import { SQLiteConversations } from './sqlite-conversations.ts';

describe('SQLiteConversations', () => {
  test('creates, gets, renames and lists conversations by activity', async () => {
    const database = openDatabase(':memory:');
    const ids = ['first', 'second'];
    const times = [100, 200];
    try {
      const conversations = new SQLiteConversations(database, {
        createId: () => ids.shift()!,
        now: () => times.shift()!,
      });

      const first = await conversations.create();
      const second = await conversations.create();
      await conversations.rename(first.id, '  First conversation  ');

      expect(first).toEqual({ id: 'first', createdAt: 100, updatedAt: 100 });
      expect(second).toEqual({ id: 'second', createdAt: 200, updatedAt: 200 });
      expect(await conversations.get('first')).toEqual({
        ...first,
        title: 'First conversation',
      });
      expect((await conversations.list()).map(({ id }) => id)).toEqual([
        'second',
        'first',
      ]);
      expect(await conversations.latest()).toEqual(second);
    } finally {
      database.close();
    }
  });

  test('archives without deleting history and explicitly unarchives', async () => {
    const database = openDatabase(':memory:');
    const times = [100, 200, 300];
    try {
      const conversations = new SQLiteConversations(database, {
        createId: () => 'conversation',
        now: () => times.shift()!,
      });
      const created = await conversations.create();
      database
        .query(
          `INSERT INTO conversation_items (session_id, item_json, created_at)
           VALUES (?, ?, ?)`,
        )
        .run(created.id, '{"role":"user","content":"hello"}', 101);

      await conversations.archive(created.id);

      expect(await conversations.list()).toEqual([]);
      expect(await conversations.latest()).toBeUndefined();
      expect((await conversations.list({ includeArchived: true }))[0]).toEqual({
        ...created,
        archivedAt: 200,
      });
      expect(
        database.query('SELECT count(*) AS count FROM conversation_items').get(),
      ).toEqual({ count: 1 });

      await conversations.unarchive(created.id);

      expect(await conversations.latest()).toEqual({
        ...created,
        updatedAt: 300,
      });
    } finally {
      database.close();
    }
  });

  test('uses insertion order when timestamps are equal', async () => {
    const database = openDatabase(':memory:');
    const ids = ['first', 'second'];
    try {
      const conversations = new SQLiteConversations(database, {
        createId: () => ids.shift()!,
        now: () => 100,
      });

      await conversations.create();
      const second = await conversations.create();

      expect(await conversations.latest()).toEqual(second);
      expect((await conversations.list()).map(({ id }) => id)).toEqual([
        'second',
        'first',
      ]);
    } finally {
      database.close();
    }
  });

  test('reports unknown conversations and rejects an empty title', async () => {
    const database = openDatabase(':memory:');
    try {
      const conversations = new SQLiteConversations(database);

      expect(await conversations.get('missing')).toBeUndefined();
      await expect(conversations.rename('missing', 'name')).rejects.toBeInstanceOf(
        ConversationNotFoundError,
      );
      await expect(conversations.archive('missing')).rejects.toBeInstanceOf(
        ConversationNotFoundError,
      );
      await expect(conversations.unarchive('missing')).rejects.toBeInstanceOf(
        ConversationNotFoundError,
      );
      await expect(conversations.rename('missing', '   ')).rejects.toBeInstanceOf(
        TypeError,
      );
    } finally {
      database.close();
    }
  });
});
