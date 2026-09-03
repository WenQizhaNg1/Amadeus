import { describe, expect, test } from 'bun:test';

import {
  closeDatabase,
  openDatabase,
} from '../../src/storage/database.ts';
import { DatabaseMemory } from '../../src/memory/database-memory.ts';

describe('DatabaseMemory', () => {
  test('stores nodes and finds claims in both directions', async () => {
    const database = await openDatabase(':memory:');
    try {
      const memory = new DatabaseMemory(database);
      await memory.addNode({
        id: 'amadeus',
        content: { kind: 'inline', value: 'AMADEUS' },
      });
      await memory.addNode({
        id: 'music',
        content: { kind: 'ref', uri: 'wiki://music' },
      });
      await memory.addClaim({
        id: 'belief-1',
        from: 'amadeus',
        to: 'music',
        relation: 'likes',
        createdAt: 100,
      });
      const belief = {
        id: 'belief-1',
        from: 'amadeus',
        to: 'music',
        relation: 'likes',
        createdAt: 100,
      };

      expect(await memory.getNode('amadeus')).toEqual({
        id: 'amadeus',
        content: { kind: 'inline', value: 'AMADEUS' },
      });
      expect(await memory.getClaim('belief-1')).toEqual(belief);
      expect(await memory.findClaims('amadeus')).toEqual([belief]);
      expect(await memory.findClaims('music')).toEqual([belief]);
    } finally {
      closeDatabase(database);
    }
  });

  test('rejects claims whose nodes do not exist', async () => {
    const database = await openDatabase(':memory:');
    try {
      const memory = new DatabaseMemory(database);
      await expect(
        memory.addClaim({
          id: 'invalid',
          from: 'missing-a',
          to: 'missing-b',
          relation: 'knows',
          createdAt: 100,
        }),
      ).rejects.toThrow();
    } finally {
      closeDatabase(database);
    }
  });
});
