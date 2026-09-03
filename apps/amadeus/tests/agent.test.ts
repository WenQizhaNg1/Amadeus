import { describe, expect, test } from 'bun:test';
import type { Model } from '@openai/agents';
import { join } from 'node:path';

import { coreInstructions, createAgent } from '../src/agent.ts';
import { loadOntology } from '../src/memory/ontology.ts';
import { createMemoryTools } from '../src/tools/memory.ts';
import { createOntologyTool } from '../src/tools/ontology.ts';

const model = {} as Model;

describe('createAgent', () => {
  test('combines core protocol rules with the supplied identity', () => {
    const agent = createAgent({ model, identity: '  I am persistent.  ' });

    expect(agent.model).toBe(model);
    expect(agent.instructions).toBe(
      `${coreInstructions}\n\nIdentity\n--------\nI am persistent.`,
    );
  });

  test('rejects an empty identity', () => {
    expect(() => createAgent({ model, identity: '   ' })).toThrow(TypeError);
  });

  test('exposes memory tools whose enums come from the ontology snapshot', async () => {
    const snapshot = await loadOntology(
      join(import.meta.dir, '..', 'ontology.json'),
    );
    const memoryTools = createMemoryTools(snapshot);
    const agent = createAgent({
      model,
      identity: 'I am persistent.',
      tools: [
        createOntologyTool(snapshot),
        memoryTools.rememberTool,
        memoryTools.recallTool,
        memoryTools.forgetTool,
      ],
    });

    expect(agent.tools.map(({ name }) => name)).toEqual([
      'say',
      'query_ontology',
      'remember',
      'recall',
      'forget',
    ]);
    const remember = agent.tools.find(({ name }) => name === 'remember');
    expect(remember?.type === 'function' && remember.parameters).toMatchObject({
      properties: { relation: { enum: snapshot.relations } },
    });
  });
});
