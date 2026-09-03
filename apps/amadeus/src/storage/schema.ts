import type { AgentInputItem } from '@openai/agents';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    normalizedLabel: text('normalized_label').notNull(),
  },
  (table) => [
    uniqueIndex('entities_type_key').on(table.type, table.key),
    index('entities_type_normalized_label').on(
      table.type,
      table.normalizedLabel,
    ),
  ],
);

export const entityAliases = sqliteTable(
  'entity_aliases',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    normalizedAlias: text('normalized_alias').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.normalizedAlias] }),
    index('entity_aliases_normalized').on(table.normalizedAlias, table.entityId),
  ],
);

export const claims = sqliteTable(
  'claims',
  {
    id: text('id').primaryKey(),
    from: text('from')
      .notNull()
      .references(() => entities.id),
    to: text('to')
      .notNull()
      .references(() => entities.id),
    relation: text('relation').notNull(),
    recordedAt: integer('recorded_at').notNull(),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    identityKey: text('identity_key').notNull(),
  },
  (table) => [
    uniqueIndex('claims_identity_key').on(table.identityKey),
    index('claims_from_relation_time').on(
      table.from,
      table.relation,
      table.validTo,
      table.recordedAt,
    ),
    index('claims_to_relation_time').on(
      table.to,
      table.relation,
      table.validTo,
      table.recordedAt,
    ),
    index('claims_relation_time').on(
      table.relation,
      table.validTo,
      table.recordedAt,
    ),
  ],
);

export const claimSources = sqliteTable(
  'claim_sources',
  {
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => sessions.id),
    recordedAt: integer('recorded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.conversationId] }),
    index('claim_sources_conversation').on(table.conversationId, table.claimId),
  ],
);

export type SessionEntity = typeof sessions.$inferSelect;
export type ConversationItemEntity = typeof conversationItems.$inferSelect;
export type EntityEntity = typeof entities.$inferSelect;
export type EntityAliasEntity = typeof entityAliases.$inferSelect;
export type ClaimEntity = typeof claims.$inferSelect;
export type ClaimSourceEntity = typeof claimSources.$inferSelect;
