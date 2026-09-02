import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DATABASE_VERSION,
  migrateDatabase,
  openDatabase,
  UnsupportedDatabaseVersionError,
} from './database.ts';

function userVersion(database: Database): number {
  return (
    database.query('PRAGMA user_version').get() as { user_version: number }
  ).user_version;
}

describe('database', () => {
  test('creates the version 1 conversation schema idempotently', () => {
    const database = openDatabase(':memory:');
    try {
      const objects = database
        .query(
          `SELECT name FROM sqlite_master
           WHERE name IN ('sessions', 'conversation_items',
                          'conversation_items_session_id')
           ORDER BY name`,
        )
        .all() as { name: string }[];

      expect(objects.map(({ name }) => name)).toEqual([
        'conversation_items',
        'conversation_items_session_id',
        'sessions',
      ]);
      expect(userVersion(database)).toBe(DATABASE_VERSION);
      expect(
        (database.query('PRAGMA foreign_keys').get() as { foreign_keys: number })
          .foreign_keys,
      ).toBe(1);
      expect(
        (database.query('PRAGMA busy_timeout').get() as { timeout: number })
          .timeout,
      ).toBe(5_000);
      expect(
        (database.query('PRAGMA synchronous').get() as { synchronous: number })
          .synchronous,
      ).toBe(1);
      expect(() => migrateDatabase(database)).not.toThrow();
    } finally {
      database.close();
    }
  });

  test('enforces JSON validity and cascades deleted sessions', () => {
    const database = openDatabase(':memory:');
    try {
      database
        .query('INSERT INTO sessions (id, created_at) VALUES (?, ?)')
        .run('session-1', 1);

      expect(() =>
        database
          .query(
            `INSERT INTO conversation_items
               (session_id, item_json, created_at)
             VALUES (?, ?, ?)`,
          )
          .run('session-1', 'not-json', 2),
      ).toThrow();

      database
        .query(
          `INSERT INTO conversation_items
             (session_id, item_json, created_at)
           VALUES (?, ?, ?)`,
        )
        .run('session-1', '{"role":"user","content":"hello"}', 2);
      database.query('DELETE FROM sessions WHERE id = ?').run('session-1');

      const row = database
        .query('SELECT count(*) AS count FROM conversation_items')
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      database.close();
    }
  });

  test('persists history after the database is reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-database-'));
    const path = join(directory, 'nested', 'amadeus.db');

    try {
      const first = openDatabase(path);
      expect(
        (first.query('PRAGMA journal_mode').get() as { journal_mode: string })
          .journal_mode,
      ).toBe('wal');
      first
        .query('INSERT INTO sessions (id, created_at) VALUES (?, ?)')
        .run('session-1', 1);
      first
        .query(
          `INSERT INTO conversation_items
             (session_id, item_json, created_at)
           VALUES (?, ?, ?)`,
        )
        .run('session-1', '{"role":"user","content":"hello"}', 2);
      first.close();

      const reopened = openDatabase(path);
      try {
        const item = reopened
          .query(
            `SELECT session_id, item_json
             FROM conversation_items`,
          )
          .get() as { session_id: string; item_json: string };
        expect(item).toEqual({
          session_id: 'session-1',
          item_json: '{"role":"user","content":"hello"}',
        });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a database created by a newer application version', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`PRAGMA user_version = ${DATABASE_VERSION + 1}`);
      expect(() => migrateDatabase(database)).toThrow(
        UnsupportedDatabaseVersionError,
      );
    } finally {
      database.close();
    }
  });
});
