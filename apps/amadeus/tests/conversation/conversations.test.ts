import { describe, expect, test } from 'bun:test';
import { count } from 'drizzle-orm';

import {
  closeDatabase,
  openDatabase,
} from '../../src/storage/database.ts';
import { conversationItems } from '../../src/storage/schema.ts';
import { ConversationNotFoundError } from '../../src/conversation/conversation.ts';
import { Conversations } from '../../src/conversation/conversations.ts';

describe('Conversations', () => {
  test('creates, gets, renames and lists conversations by activity', async () => {
    const database = await openDatabase(':memory:');
    const ids = ['first', 'second'];
    const times = [100, 200];
    try {
      const conversations = new Conversations(database, {
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
      closeDatabase(database);
    }
  });

  test('archives without deleting history and explicitly unarchives', async () => {
    const database = await openDatabase(':memory:');
    const times = [100, 200, 300];
    try {
      const conversations = new Conversations(database, {
        createId: () => 'conversation',
        now: () => times.shift()!,
      });
      const created = await conversations.create();
      await database.insert(conversationItems).values({
        sessionId: created.id,
        item: { role: 'user', content: 'hello' },
        createdAt: 101,
      });

      await conversations.archive(created.id);

      expect(await conversations.list()).toEqual([]);
      expect(await conversations.latest()).toBeUndefined();
      expect((await conversations.list({ includeArchived: true }))[0]).toEqual({
        ...created,
        archivedAt: 200,
      });
      expect(
        (await database.select({ count: count() }).from(conversationItems))[0],
      ).toEqual({ count: 1 });

      await conversations.unarchive(created.id);

      expect(await conversations.latest()).toEqual({
        ...created,
        updatedAt: 300,
      });
    } finally {
      closeDatabase(database);
    }
  });

  test('uses insertion order when timestamps are equal', async () => {
    const database = await openDatabase(':memory:');
    const ids = ['first', 'second'];
    try {
      const conversations = new Conversations(database, {
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
      closeDatabase(database);
    }
  });

  test('reports unknown conversations and rejects an empty title', async () => {
    const database = await openDatabase(':memory:');
    try {
      const conversations = new Conversations(database);

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
      closeDatabase(database);
    }
  });
});
