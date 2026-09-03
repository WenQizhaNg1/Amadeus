import { describe, expect, test } from 'bun:test';
import { count, eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeDatabase,
  openDatabase,
} from '../../src/storage/database.ts';
import { conversationItems, sessions } from '../../src/storage/schema.ts';

describe('database', () => {
  test('creates the schema and applies migrations idempotently', async () => {
    const database = await openDatabase(':memory:');
    try {
      expect(await database.select().from(sessions)).toEqual([]);
      expect(await database.select().from(conversationItems)).toEqual([]);
    } finally {
      closeDatabase(database);
    }
  });

  test('cascades deleted conversations to their history', async () => {
    const database = await openDatabase(':memory:');
    try {
      await database.insert(sessions).values({
        id: 'session-1',
        createdAt: 1,
        updatedAt: 1,
      });
      await database.insert(conversationItems).values({
        sessionId: 'session-1',
        item: { role: 'user', content: 'hello' },
        createdAt: 2,
      });

      await database.delete(sessions).where(eq(sessions.id, 'session-1'));

      expect(
        (await database.select({ count: count() }).from(conversationItems))[0],
      ).toEqual({ count: 0 });
    } finally {
      closeDatabase(database);
    }
  });

  test('persists data after the database is reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-database-'));
    const path = join(directory, 'nested', 'amadeus.db');

    try {
      const first = await openDatabase(path);
      await first.insert(sessions).values({
        id: 'session-1',
        createdAt: 1,
        updatedAt: 1,
      });
      closeDatabase(first);

      const reopened = await openDatabase(path);
      try {
        expect(await reopened.select().from(sessions)).toEqual([
          {
            id: 'session-1',
            title: null,
            createdAt: 1,
            updatedAt: 1,
            archivedAt: null,
          },
        ]);
      } finally {
        closeDatabase(reopened);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
