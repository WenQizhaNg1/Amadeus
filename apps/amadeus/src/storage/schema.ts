import type { AgentInputItem } from '@openai/agents';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type { Content } from '../memory/memory.ts';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    title: text('title'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (table) => [
    index('sessions_active_updated_at').on(
      table.archivedAt,
      table.updatedAt,
    ),
  ],
);

export const conversationItems = sqliteTable(
  'conversation_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    item: text('item_json', { mode: 'json' })
      .$type<AgentInputItem>()
      .notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('conversation_items_session_id').on(table.sessionId, table.id),
    check('conversation_items_item_json_valid', sql`json_valid(${table.item})`),
  ],
);

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  content: text('content', { mode: 'json' }).$type<Content>(),
});

export const claims = sqliteTable(
  'claims',
  {
    id: text('id').primaryKey(),
    from: text('from')
      .notNull()
      .references(() => nodes.id),
    to: text('to')
      .notNull()
      .references(() => nodes.id),
    relation: text('relation').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('claims_from').on(table.from, table.relation),
    index('claims_to').on(table.to, table.relation),
  ],
);

export type SessionEntity = typeof sessions.$inferSelect;
export type ConversationItemEntity = typeof conversationItems.$inferSelect;
export type NodeEntity = typeof nodes.$inferSelect;
export type ClaimEntity = typeof claims.$inferSelect;
