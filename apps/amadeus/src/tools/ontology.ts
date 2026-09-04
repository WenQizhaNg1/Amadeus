import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../agent/context.ts';
import type { OntologySnapshot } from '../memory/ontology.ts';

export function createOntologyTool(snapshot: OntologySnapshot) {
  const parameters = {
    type: 'object',
    properties: {
      entityType: {
        type: 'string',
        enum: snapshot.entityTypes,
        description: '查看指定实体类型的定义。',
      },
      relation: {
        type: 'string',
        enum: snapshot.relations,
        description: '查看指定关系的定义和允许的端点类型。',
      },
      fromType: {
        type: 'string',
        enum: snapshot.entityTypes,
        description: '筛选允许该类型作为主体的关系。',
      },
      toType: {
        type: 'string',
        enum: snapshot.entityTypes,
        description: '筛选允许该类型作为客体的关系。',
      },
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
查看当前只读的记忆本体。不清楚关系含义或允许的端点类型时使用。
`.trim(),
    parameters,
    strict: false,
    errorFunction: null,
    execute(value) {
      return snapshot.query(input.parse(value));
    },
  });
}
