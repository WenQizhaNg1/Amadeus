import { readFile } from 'node:fs/promises';

export async function loadIdentity(path: string): Promise<string> {
  const instructions = (await readFile(path, 'utf8')).trim();
  if (!instructions) {
    throw new Error(`Identity file is empty: ${path}`);
  }
  return instructions;
}
