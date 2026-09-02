import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DATABASE_VERSION = 1;

export class UnsupportedDatabaseVersionError extends Error {
  constructor(version: number) {
    super(
      `Database version ${version} is newer than supported version ${DATABASE_VERSION}.`,
    );
    this.name = 'UnsupportedDatabaseVersionError';
  }
}

function databaseVersion(database: Database): number {
  const row = database.query('PRAGMA user_version').get() as {
    user_version: number;
  };
  return row.user_version;
}

export function migrateDatabase(database: Database): void {
  const version = databaseVersion(database);
  if (version > DATABASE_VERSION) {
    throw new UnsupportedDatabaseVersionError(version);
  }
  if (version === DATABASE_VERSION) {
    return;
  }

  const migrate = database.transaction(() => {
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE conversation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        item_json TEXT NOT NULL CHECK (json_valid(item_json)),
        created_at INTEGER NOT NULL,

        FOREIGN KEY (session_id)
          REFERENCES sessions(id)
          ON DELETE CASCADE
      );

      CREATE INDEX conversation_items_session_id
        ON conversation_items(session_id, id);

      PRAGMA user_version = 1;
    `);
  });
  migrate();
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const database = new Database(path, { create: true });
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    migrateDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
