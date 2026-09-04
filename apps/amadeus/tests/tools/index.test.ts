import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadOntology } from '../../src/memory/ontology.ts';
import { createTools } from '../../src/tools/index.ts';

const ontologyPath = join(import.meta.dir, '..', '..', 'ontology.json');

describe('createTools', () => {
  test('exposes the complete tool set with unique names', async () => {
    const ontology = await loadOntology(ontologyPath);
    const names = createTools(ontology).map(({ name }) => name);

    expect(names).toEqual([
      'say',
      'query_ontology',
      'remember',
      'recall',
      'forget',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
