import { describe, expect, test } from 'bun:test';
import type { Model } from '@openai/agents';

import { coreInstructions, createAgent } from './agent.ts';

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
});
