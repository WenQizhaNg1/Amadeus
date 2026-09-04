import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { DatabaseMemory } from '../../src/memory/database-memory.ts';
import { loadOntology } from '../../src/memory/ontology.ts';
import {
  closeDatabase,
  openDatabase,
  type Database,
} from '../../src/storage/database.ts';
import {
  claims,
  entities,
  entityAliases,
  sessions,
} from '../../src/storage/schema.ts';
import { ontologyPath } from '../support/paths.ts';

async function fixture(): Promise<{
  database: Database;
  memory: DatabaseMemory;
}> {
  const database = await openDatabase(':memory:');
  await database.insert(sessions).values([
    { id: 'conversation-1', createdAt: 1, updatedAt: 1 },
    { id: 'conversation-2', createdAt: 2, updatedAt: 2 },
  ]);
  const memory = new DatabaseMemory(database, await loadOntology(ontologyPath));
  await memory.initialize();
  return { database, memory };
}

function memoryContext(conversationId = 'conversation-1', now = 100) {
  return { conversationId, now: () => now };
}

describe('DatabaseMemory', () => {
  test('remembers idempotently, resolves normalized labels, and records sources', async () => {
    const { database, memory } = await fixture();
    try {
      const input = {
        subject: { type: 'person', key: 'self' },
        relation: 'prefers',
        object: { type: 'concept', label: '  Classical Music  ' },
      } as const;
      const first = await memory.remember(input, memoryContext());
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const repeated = await memory.remember(
        { ...input, object: { type: 'concept', label: 'classical music' } },
        memoryContext('conversation-2', 200),
      );
      expect(repeated.ok).toBe(true);
      if (!repeated.ok) return;
      expect(repeated.created).toBe(false);
      expect(repeated.claim.id).toBe(first.claim.id);

      const recalled = await memory.recall({
        subject: { type: 'person', key: 'self' },
        relation: 'prefers',
        includeSources: true,
      });
      expect(recalled).toMatchObject({ ok: true, truncated: false });
      if (!recalled.ok) return;
      expect(recalled.claims).toHaveLength(1);
      expect(recalled.claims[0]?.object).toMatchObject({
        type: 'concept',
        label: 'Classical Music',
      });
      expect(recalled.claims[0]?.sources?.map(({ conversationId }) => conversationId))
        .toEqual(['conversation-1', 'conversation-2']);
      expect(await database.select().from(claims)).toHaveLength(1);
    } finally {
      await closeDatabase(database);
    }
  });

  test('rejects invalid ontology endpoints and temporal ranges without writes', async () => {
    const { database, memory } = await fixture();
    try {
      expect(
        await memory.remember(
          {
            subject: { type: 'place', label: 'Shanghai' },
            relation: 'knows',
            object: { type: 'person', label: 'Alice' },
          },
          memoryContext(),
        ),
      ).toMatchObject({ ok: false, error: 'unsupported_ontology' });
      expect(
        await memory.remember(
          {
            subject: { type: 'person', key: 'self' },
            relation: 'located_in',
            object: { type: 'place', label: 'Shanghai' },
            validFrom: '2026-09-04',
            validTo: '2026-09-04',
          },
          memoryContext(),
        ),
      ).toMatchObject({ ok: false, error: 'invalid_temporal_range' });
      expect(await database.select().from(claims)).toEqual([]);
      expect(
        (await database.select().from(entities)).map(({ key }) => key).sort(),
      ).toEqual(['amadeus', 'self']);
    } finally {
      await closeDatabase(database);
    }
  });

  test('returns candidates when a label or alias is ambiguous', async () => {
    const { database, memory } = await fixture();
    try {
      await database.insert(entities).values([
        {
          id: 'alice-1',
          type: 'person',
          key: 'alice-one',
          label: 'Alice',
          normalizedLabel: 'alice',
        },
        {
          id: 'alice-2',
          type: 'person',
          key: 'alice-two',
          label: 'Alice Chen',
          normalizedLabel: 'alice chen',
        },
      ]);
      await database.insert(entityAliases).values({
        entityId: 'alice-2',
        alias: 'Alice',
        normalizedAlias: 'alice',
      });

      const result = await memory.recall({
        subject: { type: 'person', label: 'ALICE' },
        relation: 'knows',
      });
      expect(result).toMatchObject({
        ok: false,
        error: 'ambiguous_entity',
        candidates: [{ id: 'alice-1' }, { id: 'alice-2' }],
      });
    } finally {
      await closeDatabase(database);
    }
  });

  test('rolls back entities created by a rejected supersession', async () => {
    const { database, memory } = await fixture();
    try {
      const old = await memory.remember(
        {
          subject: { type: 'person', key: 'self' },
          relation: 'prefers',
          object: { type: 'concept', label: 'Concise answers' },
        },
        memoryContext(),
      );
      expect(old.ok).toBe(true);
      if (!old.ok) return;
      const before = await database.select().from(entities);

      const rejected = await memory.remember(
        {
          subject: { type: 'person', label: 'Alice' },
          relation: 'prefers',
          object: { type: 'activity', label: 'Running' },
          validFrom: '2026-09-03',
          supersedes: [{ claimId: old.claim.id, validTo: '2026-09-03' }],
        },
        memoryContext(),
      );
      expect(rejected).toMatchObject({
        ok: false,
        error: 'invalid_supersession',
      });
      expect(await database.select().from(entities)).toEqual(before);
      expect(await database.select().from(claims)).toHaveLength(1);
    } finally {
      await closeDatabase(database);
    }
  });

  test('supersedes explicitly and applies current, historical, and snapshot filters', async () => {
    const { database, memory } = await fixture();
    try {
      const old = await memory.remember(
        {
          subject: { type: 'person', key: 'self' },
          relation: 'located_in',
          object: { type: 'place', label: 'Beijing' },
          validFrom: '2020-01-01',
        },
        memoryContext(),
      );
      expect(old.ok).toBe(true);
      if (!old.ok) return;

      const current = await memory.remember(
        {
          subject: { type: 'person', key: 'self' },
          relation: 'located_in',
          object: { type: 'place', label: 'Shanghai' },
          validFrom: '2026-09-03',
          supersedes: [{ claimId: old.claim.id, validTo: '2026-09-03' }],
        },
        memoryContext('conversation-2', 200),
      );
      expect(current.ok).toBe(true);

      const active = await memory.recall({ relation: 'located_in' });
      expect(active.ok && active.claims.map(({ object }) => object.label)).toEqual([
        'Shanghai',
      ]);
      const historical = await memory.recall({
        relation: 'located_in',
        includeHistorical: true,
      });
      expect(historical.ok && historical.claims).toHaveLength(2);
      const snapshot = await memory.recall({
        relation: 'located_in',
        at: '2022-01-01',
      });
      expect(snapshot.ok && snapshot.claims.map(({ object }) => object.label)).toEqual([
        'Beijing',
      ]);
      const exactHistorical = await memory.recall({
        claimIds: [old.claim.id],
        includeSources: true,
      });
      expect(exactHistorical.ok && exactHistorical.claims[0]?.id).toBe(
        old.claim.id,
      );

      const retry = await memory.remember(
        {
          subject: { type: 'person', key: 'self' },
          relation: 'located_in',
          object: { type: 'place', label: 'Shanghai' },
          validFrom: '2026-09-03',
          supersedes: [{ claimId: old.claim.id, validTo: '2026-09-03' }],
        },
        memoryContext('conversation-2', 300),
      );
      expect(retry).toMatchObject({ ok: true, created: false });
    } finally {
      await closeDatabase(database);
    }
  });

  test('forgets exact claims and removes only unreferenced non-reserved entities', async () => {
    const { database, memory } = await fixture();
    try {
      const remembered = await memory.remember(
        {
          subject: { type: 'person', key: 'self' },
          relation: 'owns',
          object: { type: 'artifact', label: 'Old laptop' },
        },
        memoryContext(),
      );
      expect(remembered.ok).toBe(true);
      if (!remembered.ok) return;

      expect(await memory.forget({ claimIds: [remembered.claim.id, 'missing'] }))
        .toEqual({
          ok: true,
          deleted: [remembered.claim.id],
          notFound: ['missing'],
          rejected: [],
        });
      expect(await database.select().from(claims)).toEqual([]);
      expect(
        await database
          .select({ key: entities.key })
          .from(entities)
          .where(eq(entities.type, 'artifact')),
      ).toEqual([]);
      expect(
        (await database.select().from(entities)).map(({ key }) => key).sort(),
      ).toEqual(['amadeus', 'self']);
    } finally {
      await closeDatabase(database);
    }
  });
});
