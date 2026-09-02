import { describe, expect, test } from 'bun:test';
import type { AgentInputItem } from '@openai/agents';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from './database.ts';
import { SQLiteSession } from './session.ts';

function user(text: string): AgentInputItem {
  return { role: 'user', content: text };
}

describe('SQLiteSession', () => {
  test('uses a stable default ID and creates its session row', async () => {
    const database = openDatabase(':memory:');
    try {
      const session = new SQLiteSession(database, undefined, () => 123);

      expect(await session.getSessionId()).toBe('primary');
      expect(
        database.query('SELECT id, created_at FROM sessions').get(),
      ).toEqual({ id: 'primary', created_at: 123 });
    } finally {
      database.close();
    }
  });

  test('appends batches in order and returns the newest limit chronologically', async () => {
    const database = openDatabase(':memory:');
    try {
      const session = new SQLiteSession(database, 'test');
      const items = [user('one'), user('two'), user('three')];

      await session.addItems(items.slice(0, 2));
      await session.addItems(items.slice(2));

      expect(await session.getItems()).toEqual(items);
      expect(await session.getItems(2)).toEqual(items.slice(1));
      expect(await session.getItems(10)).toEqual(items);
      expect(await session.getItems(0)).toEqual([]);
    } finally {
      database.close();
    }
  });

  test('rejects invalid limits', async () => {
    const database = openDatabase(':memory:');
    try {
      const session = new SQLiteSession(database);

      await expect(session.getItems(-1)).rejects.toBeInstanceOf(RangeError);
      await expect(session.getItems(1.5)).rejects.toBeInstanceOf(RangeError);
      await expect(session.getItems(Number.NaN)).rejects.toBeInstanceOf(
        RangeError,
      );
    } finally {
      database.close();
    }
  });

  test('serializes a batch before writing any of it', async () => {
    const database = openDatabase(':memory:');
    try {
      const session = new SQLiteSession(database);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      await expect(
        session.addItems([user('valid'), cyclic as AgentInputItem]),
      ).rejects.toBeInstanceOf(TypeError);
      expect(await session.getItems()).toEqual([]);

      await session.addItems([]);
      expect(await session.getItems()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test('pops the newest item and returns undefined when empty', async () => {
    const database = openDatabase(':memory:');
    try {
      const session = new SQLiteSession(database);
      await session.addItems([user('one'), user('two')]);

      expect(await session.popItem()).toEqual(user('two'));
      expect(await session.getItems()).toEqual([user('one')]);
      expect(await session.popItem()).toEqual(user('one'));
      expect(await session.popItem()).toBeUndefined();
    } finally {
      database.close();
    }
  });

  test('clears only its own history and retains both session identities', async () => {
    const database = openDatabase(':memory:');
    try {
      const first = new SQLiteSession(database, 'first');
      const second = new SQLiteSession(database, 'second');
      await first.addItems([user('first item')]);
      await second.addItems([user('second item')]);

      await first.clearSession();

      expect(await first.getItems()).toEqual([]);
      expect(await second.getItems()).toEqual([user('second item')]);
      const sessions = database
        .query('SELECT id FROM sessions ORDER BY id')
        .all() as { id: string }[];
      expect(sessions.map(({ id }) => id)).toEqual(['first', 'second']);
    } finally {
      database.close();
    }
  });

  test('retains conversation history after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-session-'));
    const path = join(directory, 'amadeus.db');

    try {
      const firstDatabase = openDatabase(path);
      const firstSession = new SQLiteSession(firstDatabase, 'persistent');
      await firstSession.addItems([user('remember me')]);
      firstDatabase.close();

      const reopenedDatabase = openDatabase(path);
      try {
        const reopenedSession = new SQLiteSession(
          reopenedDatabase,
          'persistent',
        );
        expect(await reopenedSession.getItems()).toEqual([
          user('remember me'),
        ]);
      } finally {
        reopenedDatabase.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an empty session ID', () => {
    const database = openDatabase(':memory:');
    try {
      expect(() => new SQLiteSession(database, '   ')).toThrow(TypeError);
    } finally {
      database.close();
    }
  });
});
