import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function connect(client: Client) {
  return drizzle({ client });
}

export type Database = ReturnType<typeof connect>;

const migrationsFolder = resolve(import.meta.dir, '../../../../drizzle');

function databaseUrl(path: string): string {
  return path === ':memory:' ? 'file::memory:' : `file:${resolve(path)}`;
}

export async function openDatabase(path: string): Promise<Database> {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const client = createClient({ url: databaseUrl(path) });
  const database = connect(client);

  try {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA synchronous = NORMAL');
    await migrate(database, { migrationsFolder });
    return database;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function closeDatabase(database: Database): void {
  database.$client.close();
}
