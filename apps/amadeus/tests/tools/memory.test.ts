import { describe, expect, test } from 'bun:test';
import { RunContext } from '@openai/agents';
import { join } from 'node:path';

import type { AmadeusContext } from '../../src/context.ts';
import { DatabaseMemory } from '../../src/memory/database-memory.ts';
import type { RecallResult, RememberResult } from '../../src/memory/memory.ts';
import {
  loadOntology,
  type OntologyQueryResult,
} from '../../src/memory/ontology.ts';
import {
  closeDatabase,
  openDatabase,
} from '../../src/storage/database.ts';
import { sessions } from '../../src/storage/schema.ts';
import { createMemoryTools } from '../../src/tools/memory.ts';
import { createOntologyTool } from '../../src/tools/ontology.ts';
import type { Voice } from '../../src/voice/voice.ts';

const ontologyPath = join(import.meta.dir, '..', '..', 'ontology.json');
const silentVoice = { interrupt() {} } as Voice;

describe('memory tools', () => {
  test('derive enums from the snapshot and support an explicit two-hop query', async () => {
    const snapshot = await loadOntology(ontologyPath);
    const database = await openDatabase(':memory:');
    try {
      await database.insert(sessions).values({
        id: 'conversation-1',
        createdAt: 1,
        updatedAt: 1,
      });
      const memory = new DatabaseMemory(database, snapshot);
      await memory.initialize();
      const context = new RunContext<AmadeusContext>({
        voice: silentVoice,
        memory,
        conversationId: 'conversation-1',
        now: () => 100,
      });
      const ontologyTool = createOntologyTool(snapshot);
      const tools = createMemoryTools(snapshot);

      expect(ontologyTool.parameters.properties.entityType.enum).toBe(
        snapshot.entityTypes,
      );
      expect(tools.rememberTool.parameters.properties.relation.enum).toBe(
        snapshot.relations,
      );
      const ontology = (await ontologyTool.invoke(
        context,
        JSON.stringify({ fromType: 'person', toType: 'organization' }),
      )) as OntologyQueryResult;
      expect(ontology.relations.map(({ name }) => name)).toEqual([
        'affiliated_with',
      ]);

      const knows = (await tools.rememberTool.invoke(
        context,
        JSON.stringify({
          subject: { type: 'person', key: 'self' },
          relation: 'knows',
          object: { type: 'person', label: 'Alice' },
        }),
      )) as RememberResult;
      expect(knows.ok).toBe(true);
      const aliceId = knows.claim.object.id;

      await tools.rememberTool.invoke(
        context,
        JSON.stringify({
          subject: { id: aliceId },
          relation: 'involved_in',
          object: { type: 'activity', label: 'Trail running' },
        }),
      );

      const firstHop = (await tools.recallTool.invoke(
        context,
        JSON.stringify({
          subject: { type: 'person', key: 'self' },
          relation: 'knows',
        }),
      )) as RecallResult;
      const secondHop = (await tools.recallTool.invoke(
        context,
        JSON.stringify({
          subject: { id: firstHop.claims[0]!.object.id },
          relation: 'involved_in',
        }),
      )) as RecallResult;
      expect(secondHop.claims.map(({ object }) => object.label)).toEqual([
        'Trail running',
      ]);
    } finally {
      await closeDatabase(database);
    }
  });

  test('returns ontology endpoint rejection as a structured result', async () => {
    const snapshot = await loadOntology(ontologyPath);
    const database = await openDatabase(':memory:');
    try {
      await database.insert(sessions).values({
        id: 'conversation-1',
        createdAt: 1,
        updatedAt: 1,
      });
      const memory = new DatabaseMemory(database, snapshot);
      const context = new RunContext<AmadeusContext>({
        voice: silentVoice,
        memory,
        conversationId: 'conversation-1',
        now: () => 100,
      });
      const { rememberTool } = createMemoryTools(snapshot);

      expect(
        await rememberTool.invoke(
          context,
          JSON.stringify({
            subject: { type: 'place', label: 'Shanghai' },
            relation: 'knows',
            object: { type: 'person', label: 'Alice' },
          }),
        ),
      ).toMatchObject({ ok: false, error: 'unsupported_ontology' });
    } finally {
      await closeDatabase(database);
    }
  });
});
