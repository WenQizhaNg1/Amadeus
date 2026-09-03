import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../context.ts';
import type { OntologySnapshot } from '../memory/ontology.ts';

export function createOntologyTool(snapshot: OntologySnapshot) {
  const parameters = {
    type: 'object',
    properties: {
      entityType: { type: 'string', enum: snapshot.entityTypes },
      relation: { type: 'string', enum: snapshot.relations },
      fromType: { type: 'string', enum: snapshot.entityTypes },
      toType: { type: 'string', enum: snapshot.entityTypes },
    },
    required: [] as string[],
    additionalProperties: true,
  } as const;
  const input = z.strictObject({
    entityType: z.enum(snapshot.entityTypes as [string, ...string[]]).optional(),
    relation: z.enum(snapshot.relations as [string, ...string[]]).optional(),
    fromType: z.enum(snapshot.entityTypes as [string, ...string[]]).optional(),
    toType: z.enum(snapshot.entityTypes as [string, ...string[]]).optional(),
  });

  return tool<
    typeof parameters,
    AmadeusContext,
    ReturnType<OntologySnapshot['query']>
  >({
    name: 'query_ontology',
    description: `
Inspect the current read-only memory ontology. Use this when relation meanings
or allowed endpoint types are unclear.
`.trim(),
    parameters,
    strict: false,
    errorFunction: null,
    execute(value) {
      return snapshot.query(input.parse(value));
    },
  });
}
