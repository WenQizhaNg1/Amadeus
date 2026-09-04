import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadIdentity } from '../../src/agent/identity.ts';

describe('loadIdentity', () => {
  test('loads trimmed instructions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-identity-'));
    const path = join(directory, 'identity.md');
    try {
      writeFileSync(path, '  I am AMADEUS.\n');
      expect(await loadIdentity(path)).toBe('I am AMADEUS.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an empty identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'amadeus-identity-'));
    const path = join(directory, 'identity.md');
    try {
      writeFileSync(path, ' \n ');
      await expect(loadIdentity(path)).rejects.toThrow(
        `Identity file is empty: ${path}`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('reports the missing identity path', async () => {
    const path = join(tmpdir(), `missing-amadeus-${crypto.randomUUID()}.md`);
    await expect(loadIdentity(path)).rejects.toThrow(path);
  });
});
