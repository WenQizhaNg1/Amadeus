import type { AgentInputItem, Session } from '@openai/agents';
import { and, asc, desc, eq } from 'drizzle-orm';

import type { Database } from '../storage/database.ts';
import { conversationItems, sessions } from '../storage/schema.ts';

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError('Session item limit must be a non-negative integer.');
  }
}

function validateItems(items: AgentInputItem[]): void {
  for (const item of items) {
    if (JSON.stringify(item) === undefined) {
      throw new TypeError('Session item must be JSON serializable.');
    }
  }
}

/** Persistent Agents SDK conversation history backed by the shared database. */
export class ConversationSession implements Session {
  readonly #database: Database;
  readonly #sessionId: string;
  readonly #now: () => number;
  #ready?: Promise<void>;

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
  }

  async getSessionId(): Promise<string> {
    await this.#ensureSession();
    return this.#sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    validateLimit(limit);
    await this.#ensureSession();
    if (limit === 0) {
      return [];
    }
    if (limit === undefined) {
      const rows = await this.#database
        .select({ item: conversationItems.item })
        .from(conversationItems)
        .where(eq(conversationItems.sessionId, this.#sessionId))
        .orderBy(asc(conversationItems.id));
      return rows.map(({ item }) => item);
    }
    const rows = await this.#database
      .select({ item: conversationItems.item })
      .from(conversationItems)
      .where(eq(conversationItems.sessionId, this.#sessionId))
      .orderBy(desc(conversationItems.id))
      .limit(limit);
    return rows.reverse().map(({ item }) => item);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    validateItems(items);
    await this.#ensureSession();
    const now = this.#now();
    await this.#database.transaction(async (transaction) => {
      await transaction.insert(conversationItems).values(
        items.map((item) => ({
          sessionId: this.#sessionId,
          item,
          createdAt: now,
        })),
      );
      await transaction
        .update(sessions)
        .set({ updatedAt: now })
        .where(eq(sessions.id, this.#sessionId));
    });
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    await this.#ensureSession();
    return await this.#database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ id: conversationItems.id, item: conversationItems.item })
        .from(conversationItems)
        .where(eq(conversationItems.sessionId, this.#sessionId))
        .orderBy(desc(conversationItems.id))
        .limit(1);
      if (!row) {
        return undefined;
      }
      await transaction
        .delete(conversationItems)
        .where(
          and(
            eq(conversationItems.id, row.id),
            eq(conversationItems.sessionId, this.#sessionId),
          ),
        );
      return row.item;
    });
  }

  async clearSession(): Promise<void> {
    await this.#ensureSession();
    await this.#database
      .delete(conversationItems)
      .where(eq(conversationItems.sessionId, this.#sessionId));
  }

  #ensureSession(): Promise<void> {
    this.#ready ??= (async () => {
      const now = this.#now();
      await this.#database
        .insert(sessions)
        .values({ id: this.#sessionId, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
    })();
    return this.#ready;
  }
}
