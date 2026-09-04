import { describe, expect, test } from 'bun:test';
import type { Model } from '@openai/agents';
import { join } from 'node:path';

import { coreInstructions, createAgent } from '../../src/agent/agent.ts';
import { loadOntology } from '../../src/memory/ontology.ts';
import { createTools } from '../../src/tools/index.ts';

const model = {} as Model;

describe('createAgent', () => {
  test('combines core protocol rules with the supplied identity', () => {
    const agent = createAgent({
      model,
      identity: '  I am persistent.  ',
      tools: [],
    });

    expect(agent.model).toBe(model);
    expect(agent.instructions).toBe(
      `${coreInstructions}\n\nIdentity\n--------\nI am persistent.`,
    );
  });

  test('rejects an empty identity', () => {
    expect(() => createAgent({ model, identity: '   ', tools: [] })).toThrow(
      TypeError,
    );
  });

  test('uses the supplied tool set', async () => {
    const snapshot = await loadOntology(
      join(import.meta.dir, '..', '..', 'ontology.json'),
    );
    const tools = createTools(snapshot);
    const agent = createAgent({
      model,
      identity: 'I am persistent.',
      tools,
    });

    expect(agent.tools).toEqual(tools);
  });
});
