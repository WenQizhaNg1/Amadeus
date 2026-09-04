import { describe, expect, test } from 'bun:test';

import { loadOntology, OntologySnapshot } from '../../src/memory/ontology.ts';
import { ontologyPath } from '../support/paths.ts';

describe('OntologySnapshot', () => {
  test('loads all v0 types and relations and exposes immutable queries', async () => {
    const snapshot = await loadOntology(ontologyPath);
    expect(snapshot.entityTypes).toEqual([
      'person',
      'organization',
      'place',
      'activity',
      'concept',
      'artifact',
    ]);
    expect(snapshot.relations).toHaveLength(12);
    expect(
      snapshot
        .query({ fromType: 'person', toType: 'activity' })
        .relations.map(({ name }) => name),
    ).toEqual([
      'involved_in',
      'interested_in',
      'prefers',
      'avoids',
      'created',
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.query().relations)).toBe(true);
  });

  test('validates every declared endpoint and representative invalid endpoints', async () => {
    const snapshot = await loadOntology(ontologyPath);
    for (const relation of snapshot.query().relations) {
      for (const from of relation.from) {
        for (const to of relation.to) {
          expect(snapshot.accepts(relation.name, from, to)).toBe(true);
        }
      }
      const invalidFrom = snapshot.entityTypes.find(
        (type) => !relation.from.includes(type),
      );
      if (invalidFrom) {
        expect(snapshot.accepts(relation.name, invalidFrom, relation.to[0]!))
          .toBe(false);
      }
      const invalidTo = snapshot.entityTypes.find(
        (type) => !relation.to.includes(type),
      );
      if (invalidTo) {
        expect(snapshot.accepts(relation.name, relation.from[0]!, invalidTo))
          .toBe(false);
      }
    }
  });

  test('rejects unknown fields and relation endpoints', () => {
    expect(
      () =>
        new OntologySnapshot({
          version: 1,
          entityTypes: { person: { description: 'A person.', extra: true } },
          relations: {},
        }),
    ).toThrow();
    expect(
      () =>
        new OntologySnapshot({
          version: 1,
          entityTypes: { person: { description: 'A person.' } },
          relations: {
            knows: {
              description: 'Knows.',
              from: ['person'],
              to: ['missing'],
            },
          },
        }),
    ).toThrow('unknown entity type');
  });
});
