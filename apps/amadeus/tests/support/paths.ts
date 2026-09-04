import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..', '..', '..', '..');

export const databasePath = resolve(repositoryRoot, 'data', 'amadeus.db');

export const identityPath = resolve(
  repositoryRoot,
  'apps',
  'amadeus',
  'identity.md',
);

export const ontologyPath = resolve(repositoryRoot, 'data', 'ontology.json');
