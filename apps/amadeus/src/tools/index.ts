import type { Tool } from '@openai/agents';

import type { AmadeusContext } from '../agent/context.ts';
import type { OntologySnapshot } from '../memory/ontology.ts';
import { createMemoryTools } from './memory.ts';
import { createOntologyTool } from './ontology.ts';
import { sayTool } from './say.ts';

/** Creates the complete set of tools exposed to the AMADEUS agent. */
export function createTools(
  ontology: OntologySnapshot,
): Tool<AmadeusContext>[] {
  const memory = createMemoryTools(ontology);

  return [
    sayTool,
    createOntologyTool(ontology),
    memory.rememberTool,
    memory.recallTool,
    memory.forgetTool,
  ];
}
