import { desc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../storage/database.ts';
import { sessions, type SessionEntity } from '../storage/schema.ts';
import {
  ConversationNotFoundError,
  type Conversation,
} from './conversation.ts';

export interface ConversationsOptions {
  now?: () => number;
  createId?: () => string;
}

function conversation(row: SessionEntity): Conversation {
  return {
    id: row.id,
    title: row.title ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
  };
}

export class Conversations {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #createId: () => string;

  constructor(database: Database, options: ConversationsOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async create(): Promise<Conversation> {
    const id = this.#createId();
    const now = this.#now();
    await this.#database.insert(sessions).values({
      id,
      createdAt: now,
      updatedAt: now,
    });
    return { id, createdAt: now, updatedAt: now };
  }

  async get(id: string): Promise<Conversation | undefined> {
    const [row] = await this.#database
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row ? conversation(row) : undefined;
  }

  async list(
    options: { includeArchived?: boolean } = {},
  ): Promise<Conversation[]> {
    const order = [
      desc(sessions.updatedAt),
      desc(sessions.createdAt),
      desc(sql`rowid`),
    ];
    const rows = options.includeArchived
      ? await this.#database.select().from(sessions).orderBy(...order)
      : await this.#database
          .select()
          .from(sessions)
          .where(isNull(sessions.archivedAt))
          .orderBy(...order);
    return rows.map(conversation);
  }

  async latest(): Promise<Conversation | undefined> {
    const [row] = await this.#database
      .select()
      .from(sessions)
      .where(isNull(sessions.archivedAt))
      .orderBy(
        desc(sessions.updatedAt),
        desc(sessions.createdAt),
        desc(sql`rowid`),
      )
      .limit(1);
    return row ? conversation(row) : undefined;
  }

  async rename(id: string, title: string): Promise<void> {
    const value = title.trim();
    if (!value) {
      throw new TypeError('Conversation title must not be empty.');
    }
    const changed = await this.#database
      .update(sessions)
      .set({ title: value })
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    this.#requireChanged(id, changed.length);
  }

  async archive(id: string): Promise<void> {
    const changed = await this.#database
      .update(sessions)
      .set({ archivedAt: this.#now() })
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    this.#requireChanged(id, changed.length);
  }

  async unarchive(id: string): Promise<void> {
    const changed = await this.#database
      .update(sessions)
      .set({ archivedAt: null, updatedAt: this.#now() })
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    this.#requireChanged(id, changed.length);
  }

  #requireChanged(id: string, changes: number): void {
    if (changes === 0) {
      throw new ConversationNotFoundError(id);
    }
  }
}
