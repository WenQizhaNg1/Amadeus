import type { AgentInputItem, Session } from '@openai/agents';
import type { Database } from 'bun:sqlite';

interface StoredItem {
  id: number;
  item_json: string;
}

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError('Session item limit must be a non-negative integer.');
  }
}

function serializeItem(item: AgentInputItem): string {
  const serialized = JSON.stringify(item);
  if (serialized === undefined) {
    throw new TypeError('Session item must be JSON serializable.');
  }
  return serialized;
}

function parseItem(serialized: string): AgentInputItem {
  return JSON.parse(serialized) as AgentInputItem;
}

/** Persistent Agents SDK conversation history backed by the shared SQLite DB. */
export class SQLiteSession implements Session {
  readonly #database: Database;
  readonly #sessionId: string;
  readonly #now: () => number;

  constructor(
    database: Database,
    sessionId = 'primary',
    now: () => number = Date.now,
  ) {
    if (!sessionId.trim()) {
      throw new TypeError('Session ID must not be empty.');
    }

    this.#database = database;
    this.#sessionId = sessionId;
    this.#now = now;

    this.#database
      .query('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)')
      .run(this.#sessionId, this.#now());
  }

  async getSessionId(): Promise<string> {
    return this.#sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    validateLimit(limit);
    if (limit === 0) {
      return [];
    }

    const rows =
      limit === undefined
        ? (this.#database
            .query(
              `SELECT id, item_json
               FROM conversation_items
               WHERE session_id = ?
               ORDER BY id ASC`,
            )
            .all(this.#sessionId) as StoredItem[])
        : (this.#database
            .query(
              `SELECT id, item_json
               FROM (
                 SELECT id, item_json
                 FROM conversation_items
                 WHERE session_id = ?
                 ORDER BY id DESC
                 LIMIT ?
               )
               ORDER BY id ASC`,
            )
            .all(this.#sessionId, limit) as StoredItem[]);

    return rows.map(({ item_json }) => parseItem(item_json));
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    // Serialize first so one invalid item cannot leave a partial batch behind.
    const serializedItems = items.map(serializeItem);
    const insert = this.#database.query(
      `INSERT INTO conversation_items (session_id, item_json, created_at)
       VALUES (?, ?, ?)`,
    );
    const add = this.#database.transaction(() => {
      for (const serialized of serializedItems) {
        insert.run(this.#sessionId, serialized, this.#now());
      }
    });
    add();
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const pop = this.#database.transaction(() => {
      const row = this.#database
        .query(
          `SELECT id, item_json
           FROM conversation_items
           WHERE session_id = ?
           ORDER BY id DESC
           LIMIT 1`,
        )
        .get(this.#sessionId) as StoredItem | null;

      if (!row) {
        return undefined;
      }

      const item = parseItem(row.item_json);
      this.#database
        .query('DELETE FROM conversation_items WHERE id = ? AND session_id = ?')
        .run(row.id, this.#sessionId);
      return item;
    });

    return pop();
  }

  async clearSession(): Promise<void> {
    this.#database
      .query('DELETE FROM conversation_items WHERE session_id = ?')
      .run(this.#sessionId);
  }
}
