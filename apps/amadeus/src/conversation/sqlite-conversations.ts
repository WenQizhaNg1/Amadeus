import type { Database } from 'bun:sqlite';

import {
  ConversationNotFoundError,
  type Conversation,
} from './conversation.ts';

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface SQLiteConversationsOptions {
  now?: () => number;
  createId?: () => string;
}

function conversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

export class SQLiteConversations {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #createId: () => string;

  constructor(
    database: Database,
    options: SQLiteConversationsOptions = {},
  ) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async create(): Promise<Conversation> {
    const id = this.#createId();
    const now = this.#now();
    this.#database
      .query(
        `INSERT INTO sessions (id, created_at, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(id, now, now);
    return { id, createdAt: now, updatedAt: now };
  }

  async get(id: string): Promise<Conversation | undefined> {
    const row = this.#database
      .query(
        `SELECT id, title, created_at, updated_at, archived_at
         FROM sessions
         WHERE id = ?`,
      )
      .get(id) as ConversationRow | null;
    return row ? conversation(row) : undefined;
  }

  async list(
    options: { includeArchived?: boolean } = {},
  ): Promise<Conversation[]> {
    const rows = this.#database
      .query(
        `SELECT id, title, created_at, updated_at, archived_at
         FROM sessions
         ${options.includeArchived ? '' : 'WHERE archived_at IS NULL'}
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all() as ConversationRow[];
    return rows.map(conversation);
  }

  async latest(): Promise<Conversation | undefined> {
    const row = this.#database
      .query(
        `SELECT id, title, created_at, updated_at, archived_at
         FROM sessions
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC, created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get() as ConversationRow | null;
    return row ? conversation(row) : undefined;
  }

  async rename(id: string, title: string): Promise<void> {
    const value = title.trim();
    if (!value) {
      throw new TypeError('Conversation title must not be empty.');
    }
    this.#requireChanged(
      id,
      this.#database
        .query('UPDATE sessions SET title = ? WHERE id = ?')
        .run(value, id).changes,
    );
  }

  async archive(id: string): Promise<void> {
    this.#requireChanged(
      id,
      this.#database
        .query('UPDATE sessions SET archived_at = ? WHERE id = ?')
        .run(this.#now(), id).changes,
    );
  }

  async unarchive(id: string): Promise<void> {
    const now = this.#now();
    this.#requireChanged(
      id,
      this.#database
        .query(
          `UPDATE sessions
           SET archived_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, id).changes,
    );
  }

  #requireChanged(id: string, changes: number): void {
    if (changes === 0) {
      throw new ConversationNotFoundError(id);
    }
  }
}
