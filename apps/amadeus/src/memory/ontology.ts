import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-z0-9_]*$/);
const description = z.string().trim().min(1).max(500);
const ontologyDocument = z.strictObject({
  version: z.literal(1),
  entityTypes: z
    .record(name, z.strictObject({ description }))
    .refine((value) => Object.keys(value).length > 0, 'entityTypes is empty.'),
  relations: z.record(
    name,
    z.strictObject({
      description,
      from: z.array(name).min(1),
      to: z.array(name).min(1),
    }),
  ).refine((value) => Object.keys(value).length > 0, 'relations is empty.'),
});

type OntologyDocument = z.infer<typeof ontologyDocument>;

export interface OntologyEntityType {
  name: string;
  description: string;
}

export interface OntologyRelation {
  name: string;
  description: string;
  from: readonly string[];
  to: readonly string[];
}

export interface OntologyQuery {
  entityType?: string;
  relation?: string;
  fromType?: string;
  toType?: string;
}

export interface OntologyQueryResult {
  version: number;
  entityTypes: readonly OntologyEntityType[];
  relations: readonly OntologyRelation[];
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} must not contain duplicate names.`);
  }
}

function freezeDocument(document: OntologyDocument): OntologyDocument {
  for (const definition of Object.values(document.entityTypes)) {
    Object.freeze(definition);
  }
  for (const definition of Object.values(document.relations)) {
    Object.freeze(definition.from);
    Object.freeze(definition.to);
    Object.freeze(definition);
  }
  Object.freeze(document.entityTypes);
  Object.freeze(document.relations);
  return Object.freeze(document);
}

export class OntologySnapshot {
  readonly version: number;
  readonly entityTypes: readonly string[];
  readonly relations: readonly string[];

  readonly #document: OntologyDocument;

  constructor(value: unknown) {
    const document = ontologyDocument.parse(value);
    const entityTypes = Object.keys(document.entityTypes);
    const relations = Object.keys(document.relations);
    const knownTypes = new Set(entityTypes);
    for (const [relation, definition] of Object.entries(document.relations)) {
      unique(definition.from, `relations.${relation}.from`);
      unique(definition.to, `relations.${relation}.to`);
      for (const type of [...definition.from, ...definition.to]) {
        if (!knownTypes.has(type)) {
          throw new TypeError(
            `Relation ${relation} references unknown entity type: ${type}`,
          );
        }
      }
    }

    this.#document = freezeDocument(document);
    this.version = document.version;
    this.entityTypes = Object.freeze(entityTypes);
    this.relations = Object.freeze(relations);
    Object.freeze(this);
  }

  hasEntityType(type: string): boolean {
    return Object.hasOwn(this.#document.entityTypes, type);
  }

  hasRelation(relation: string): boolean {
    return Object.hasOwn(this.#document.relations, relation);
  }

  accepts(relation: string, fromType: string, toType: string): boolean {
    const definition = this.#document.relations[relation];
    return Boolean(
      definition?.from.includes(fromType) && definition.to.includes(toType),
    );
  }

  query(query: OntologyQuery = {}): OntologyQueryResult {
    const entityTypes = Object.entries(this.#document.entityTypes)
      .filter(([type]) => !query.entityType || type === query.entityType)
      .map(([type, value]) => Object.freeze({ name: type, ...value }));
    const relations = Object.entries(this.#document.relations)
      .filter(([relation, value]) =>
        (!query.relation || relation === query.relation) &&
        (!query.fromType || value.from.includes(query.fromType)) &&
        (!query.toType || value.to.includes(query.toType)),
      )
      .map(([relation, value]) => Object.freeze({
        name: relation,
        description: value.description,
        from: value.from,
        to: value.to,
      }));
    return Object.freeze({
      version: this.version,
      entityTypes: Object.freeze(entityTypes),
      relations: Object.freeze(relations),
    });
  }
}

export async function loadOntology(path: string): Promise<OntologySnapshot> {
  const source = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`Invalid ontology JSON at ${path}`, { cause: error });
  }
  return new OntologySnapshot(value);
}
