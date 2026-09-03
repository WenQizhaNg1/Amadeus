import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import type { Database } from '../storage/database.ts';
import {
  claims,
  claimSources,
  entities,
  entityAliases,
} from '../storage/schema.ts';
import type {
  Claim,
  Entity,
  EntitySelector,
  ForgetInput,
  ForgetResult,
  Memory,
  MemoryContext,
  MemoryError,
  RecallInput,
  RecalledClaim,
  RecallResult,
  RememberInput,
  RememberResult,
} from './memory.ts';
import type { OntologySnapshot } from './ontology.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const RESERVED_ENTITIES = [
  {
    id: 'entity_self',
    type: 'person',
    key: 'self',
    label: 'Self',
    normalizedLabel: 'self',
  },
  {
    id: 'entity_amadeus',
    type: 'person',
    key: 'amadeus',
    label: 'AMADEUS',
    normalizedLabel: 'amadeus',
  },
] as const;
const RESERVED_IDS = new Set<string>(RESERVED_ENTITIES.map(({ id }) => id));

type Transaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type Executor = Database | Transaction;

class MemoryRejection extends Error {
  constructor(readonly result: MemoryError) {
    super(result.message);
  }
}

function error(
  code: MemoryError['error'],
  message: string,
  details: Pick<MemoryError, 'candidates' | 'claimIds'> = {},
): MemoryError {
  return { ok: false, error: code, message, ...details };
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateTemporal(
  validFrom?: string,
  validTo?: string,
): MemoryError | undefined {
  if (
    (validFrom !== undefined && !isIsoDate(validFrom)) ||
    (validTo !== undefined && !isIsoDate(validTo)) ||
    (validFrom !== undefined && validTo !== undefined && validFrom >= validTo)
  ) {
    return error(
      'invalid_temporal_range',
      'Dates must use YYYY-MM-DD and validFrom must be earlier than validTo.',
    );
  }
  return undefined;
}

function claimIdentity(
  from: string,
  relation: string,
  to: string,
  validFrom?: string,
  validTo?: string,
): string {
  return JSON.stringify([from, relation, to, validFrom ?? null, validTo ?? null]);
}

function validateSelector(
  selector: EntitySelector,
  snapshot: OntologySnapshot,
): MemoryError | undefined {
  if ('id' in selector) {
    if (!selector.id.trim() || selector.id.length > 128) {
      return error('entity_not_found', 'Entity ID is invalid.');
    }
    return undefined;
  }
  if (!snapshot.hasEntityType(selector.type)) {
    return error(
      'unsupported_ontology',
      `Unknown entity type: ${selector.type}`,
    );
  }
  const value = 'key' in selector ? selector.key : selector.label;
  if (!value.trim() || value.length > 200) {
    return error('entity_not_found', 'Entity selector text is invalid.');
  }
  return undefined;
}

function declaredType(selector: EntitySelector): string | undefined {
  return 'type' in selector ? selector.type : undefined;
}

function toClaim(row: typeof claims.$inferSelect): Claim {
  return {
    id: row.id,
    from: row.from,
    relation: row.relation,
    to: row.to,
    recordedAt: row.recordedAt,
    validFrom: row.validFrom ?? undefined,
    validTo: row.validTo ?? undefined,
  };
}

export class DatabaseMemory implements Memory {
  constructor(
    readonly database: Database,
    readonly ontology: OntologySnapshot,
  ) {}

  async initialize(): Promise<void> {
    if (!this.ontology.hasEntityType('person')) {
      return;
    }
    await this.database
      .insert(entities)
      .values([...RESERVED_ENTITIES])
      .onConflictDoNothing();
  }

  async remember(
    input: RememberInput,
    context: MemoryContext,
  ): Promise<RememberResult | MemoryError> {
    if (!this.ontology.hasRelation(input.relation)) {
      return error(
        'unsupported_ontology',
        `Unknown relation: ${input.relation}`,
      );
    }
    const invalidSelector =
      validateSelector(input.subject, this.ontology) ??
      validateSelector(input.object, this.ontology);
    if (invalidSelector) {
      return invalidSelector;
    }
    const invalidTemporal = validateTemporal(input.validFrom, input.validTo);
    if (invalidTemporal) {
      return invalidTemporal;
    }
    for (const supersession of input.supersedes ?? []) {
      if (!isIsoDate(supersession.validTo)) {
        return error(
          'invalid_temporal_range',
          'Supersession dates must use YYYY-MM-DD.',
        );
      }
    }

    await this.initialize();
    const subjectPreview = await this.#resolve(
      this.database,
      input.subject,
      false,
    );
    if (
      'ok' in subjectPreview &&
      !('label' in input.subject && subjectPreview.error === 'entity_not_found')
    ) {
      return subjectPreview;
    }
    const objectPreview = await this.#resolve(this.database, input.object, false);
    if (
      'ok' in objectPreview &&
      !('label' in input.object && objectPreview.error === 'entity_not_found')
    ) {
      return objectPreview;
    }
    const subjectType =
      'ok' in subjectPreview ? declaredType(input.subject)! : subjectPreview.type;
    const objectType =
      'ok' in objectPreview ? declaredType(input.object)! : objectPreview.type;
    if (!this.ontology.accepts(input.relation, subjectType, objectType)) {
      return error(
        'unsupported_ontology',
        `${subjectType} - ${input.relation} -> ${objectType} is not allowed.`,
      );
    }

    try {
      return await this.database.transaction(async (tx) => {
        const subject = await this.#resolve(tx, input.subject, true);
        if ('ok' in subject) {
          throw new MemoryRejection(subject);
        }
        const object = await this.#resolve(tx, input.object, true);
        if ('ok' in object) {
          throw new MemoryRejection(object);
        }
        if (!this.ontology.accepts(input.relation, subject.type, object.type)) {
          throw new MemoryRejection(
            error(
              'unsupported_ontology',
              `${subject.type} - ${input.relation} -> ${object.type} is not allowed.`,
            ),
          );
        }

        const identityKey = claimIdentity(
          subject.id,
          input.relation,
          object.id,
          input.validFrom,
          input.validTo,
        );
        const [existing] = await tx
          .select()
          .from(claims)
          .where(eq(claims.identityKey, identityKey))
          .limit(1);
        const supersessionError = await this.#validateSupersessions(
          tx,
          input,
          subject,
          object,
          existing?.id,
        );
        if (supersessionError) {
          throw new MemoryRejection(supersessionError);
        }

        const now = context.now();
        if (!Number.isSafeInteger(now) || now < 0) {
          throw new TypeError('Memory clock must return epoch milliseconds.');
        }

        let row = existing;
        if (!row) {
          const id = `claim_${crypto.randomUUID()}`;
          await tx.insert(claims).values({
            id,
            from: subject.id,
            relation: input.relation,
            to: object.id,
            recordedAt: now,
            validFrom: input.validFrom,
            validTo: input.validTo,
            identityKey,
          });
          [row] = await tx
            .select()
            .from(claims)
            .where(eq(claims.id, id))
            .limit(1);
        }

        for (const supersession of input.supersedes ?? []) {
          const [oldClaim] = await tx
            .select()
            .from(claims)
            .where(eq(claims.id, supersession.claimId))
            .limit(1);
          if (oldClaim && oldClaim.validTo === null) {
            await tx
              .update(claims)
              .set({
                validTo: supersession.validTo,
                identityKey: claimIdentity(
                  oldClaim.from,
                  oldClaim.relation,
                  oldClaim.to,
                  oldClaim.validFrom ?? undefined,
                  supersession.validTo,
                ),
              })
              .where(eq(claims.id, oldClaim.id));
          }
        }

        await tx
          .insert(claimSources)
          .values({
            claimId: row!.id,
            conversationId: context.conversationId,
            recordedAt: now,
          })
          .onConflictDoNothing();

        return {
          ok: true as const,
          claim: await this.#recalledClaim(tx, row!, subject, object, true),
          created: existing === undefined,
        };
      });
    } catch (caught) {
      if (caught instanceof MemoryRejection) {
        return caught.result;
      }
      throw caught;
    }
  }

  async recall(input: RecallInput): Promise<RecallResult | MemoryError> {
    const modifiers = [
      input.subject,
      input.subjectType,
      input.relation,
      input.object,
      input.objectType,
    ];
    if (input.claimIds && modifiers.some((value) => value !== undefined)) {
      throw new TypeError('claimIds cannot be combined with graph filters.');
    }
    if (!input.claimIds && modifiers.every((value) => value === undefined)) {
      throw new TypeError('Recall requires claimIds or a graph filter.');
    }
    if (input.at && input.includeHistorical) {
      return error(
        'invalid_temporal_range',
        'at and includeHistorical are mutually exclusive.',
      );
    }
    if (input.at && !isIsoDate(input.at)) {
      return error('invalid_temporal_range', 'at must use YYYY-MM-DD.');
    }
    if (input.relation && !this.ontology.hasRelation(input.relation)) {
      return error('unsupported_ontology', `Unknown relation: ${input.relation}`);
    }
    for (const type of [input.subjectType, input.objectType]) {
      if (type && !this.ontology.hasEntityType(type)) {
        return error('unsupported_ontology', `Unknown entity type: ${type}`);
      }
    }
    for (const selector of [input.subject, input.object]) {
      if (selector) {
        const invalid = validateSelector(selector, this.ontology);
        if (invalid) {
          return invalid;
        }
      }
    }

    const subject = input.subject
      ? await this.#resolve(this.database, input.subject, false)
      : undefined;
    if (subject && 'ok' in subject) {
      return subject;
    }
    const object = input.object
      ? await this.#resolve(this.database, input.object, false)
      : undefined;
    if (object && 'ok' in object) {
      return object;
    }

    const requestedIds = input.claimIds
      ? [...new Set(input.claimIds)]
      : undefined;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const subjects = alias(entities, 'claim_subjects');
    const objects = alias(entities, 'claim_objects');
    const conditions: SQL[] = [];
    if (requestedIds) conditions.push(inArray(claims.id, requestedIds));
    if (subject) conditions.push(eq(claims.from, subject.id));
    if (object) conditions.push(eq(claims.to, object.id));
    if (input.subjectType) conditions.push(eq(subjects.type, input.subjectType));
    if (input.objectType) conditions.push(eq(objects.type, input.objectType));
    if (input.relation) conditions.push(eq(claims.relation, input.relation));
    if (input.at) {
      conditions.push(
        and(
          isNotNull(claims.validFrom),
          lte(claims.validFrom, input.at),
          or(isNull(claims.validTo), gt(claims.validTo, input.at)),
        )!,
      );
    } else if (!input.includeHistorical && !requestedIds) {
      conditions.push(isNull(claims.validTo));
    }

    const rows = await this.database
      .select({ claim: claims })
      .from(claims)
      .innerJoin(subjects, eq(claims.from, subjects.id))
      .innerJoin(objects, eq(claims.to, objects.id))
      .where(and(...conditions))
      .orderBy(desc(claims.recordedAt), asc(claims.id))
      .limit(requestedIds ? requestedIds.length : limit + 1);

    if (requestedIds) {
      const found = new Set(rows.map(({ claim }) => claim.id));
      const missing = requestedIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return error('unknown_claim', 'One or more claims do not exist.', {
          claimIds: missing,
        });
      }
    }

    const truncated = rows.length > limit;
    const selected = rows.slice(0, limit);
    const hydrated = await Promise.all(
      selected.map(async ({ claim }) => {
        const subjectEntity = await this.#entity(this.database, claim.from);
        const objectEntity = await this.#entity(this.database, claim.to);
        return await this.#recalledClaim(
          this.database,
          claim,
          subjectEntity!,
          objectEntity!,
          input.includeSources ?? false,
        );
      }),
    );
    return { ok: true, claims: hydrated, truncated };
  }

  async forget(input: ForgetInput): Promise<ForgetResult> {
    const requested = [...new Set(input.claimIds)];
    return await this.database.transaction(async (tx) => {
      const found = requested.length
        ? await tx.select().from(claims).where(inArray(claims.id, requested))
        : [];
      const foundIds = new Set(found.map(({ id }) => id));
      const deleted = requested.filter((id) => foundIds.has(id));
      const notFound = requested.filter((id) => !foundIds.has(id));
      if (deleted.length > 0) {
        await tx.delete(claims).where(inArray(claims.id, deleted));
      }

      const endpoints = new Set(found.flatMap((claim) => [claim.from, claim.to]));
      for (const id of endpoints) {
        if (RESERVED_IDS.has(id)) continue;
        const [reference] = await tx
          .select({ id: claims.id })
          .from(claims)
          .where(or(eq(claims.from, id), eq(claims.to, id)))
          .limit(1);
        if (!reference) {
          await tx.delete(entities).where(eq(entities.id, id));
        }
      }

      return { ok: true, deleted, notFound, rejected: [] };
    });
  }

  async #resolve(
    executor: Executor,
    selector: EntitySelector,
    create: boolean,
  ): Promise<Entity | MemoryError> {
    if ('id' in selector) {
      const entity = await this.#entity(executor, selector.id);
      return entity ?? error('entity_not_found', `Entity not found: ${selector.id}`);
    }
    if ('key' in selector) {
      const [row] = await executor
        .select()
        .from(entities)
        .where(and(eq(entities.type, selector.type), eq(entities.key, selector.key)))
        .limit(1);
      return row
        ? (await this.#entity(executor, row.id))!
        : error(
            'entity_not_found',
            `Entity not found: ${selector.type}:${selector.key}`,
          );
    }

    const normalizedLabel = normalize(selector.label);
    const rows = await executor
      .selectDistinct({ id: entities.id })
      .from(entities)
      .leftJoin(entityAliases, eq(entityAliases.entityId, entities.id))
      .where(
        and(
          eq(entities.type, selector.type),
          or(
            eq(entities.normalizedLabel, normalizedLabel),
            eq(entityAliases.normalizedAlias, normalizedLabel),
          ),
        ),
      );
    const matches = await Promise.all(
      rows.map(({ id }) => this.#entity(executor, id)),
    );
    const candidates = matches.filter((value): value is Entity => Boolean(value));
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) {
      return error(
        'ambiguous_entity',
        `Entity label is ambiguous: ${selector.label}`,
        { candidates },
      );
    }
    if (!create) {
      return error(
        'entity_not_found',
        `Entity not found: ${selector.type}:${selector.label}`,
      );
    }

    const key = await this.#availableKey(executor, selector.type, normalizedLabel);
    const id = `entity_${crypto.randomUUID()}`;
    await executor.insert(entities).values({
      id,
      type: selector.type,
      key,
      label: selector.label.trim(),
      normalizedLabel,
    });
    return (await this.#entity(executor, id))!;
  }

  async #availableKey(
    executor: Executor,
    type: string,
    normalizedLabel: string,
  ): Promise<string> {
    const base =
      normalizedLabel
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64) || 'entity';
    const [existing] = await executor
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.type, type), eq(entities.key, base)))
      .limit(1);
    return existing ? `${base}-${crypto.randomUUID().slice(0, 8)}` : base;
  }

  async #entity(executor: Executor, id: string): Promise<Entity | undefined> {
    const [row] = await executor
      .select()
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);
    if (!row) return undefined;
    const aliases = await executor
      .select({ alias: entityAliases.alias })
      .from(entityAliases)
      .where(eq(entityAliases.entityId, id))
      .orderBy(asc(entityAliases.alias));
    return {
      id: row.id,
      type: row.type,
      key: row.key,
      label: row.label,
      aliases: aliases.map(({ alias }) => alias),
    };
  }

  async #validateSupersessions(
    executor: Executor,
    input: RememberInput,
    subject: Entity,
    object: Entity,
    newClaimId?: string,
  ): Promise<MemoryError | undefined> {
    const requested = input.supersedes ?? [];
    if (requested.length === 0) return undefined;
    const ids = [...new Set(requested.map(({ claimId }) => claimId))];
    if (ids.length !== requested.length) {
      return error('invalid_supersession', 'A claim may only be superseded once.');
    }
    const rows = await executor.select().from(claims).where(inArray(claims.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return error('unknown_claim', 'A superseded claim does not exist.', {
        claimIds: missing,
      });
    }
    for (const requestedClaim of requested) {
      const oldClaim = byId.get(requestedClaim.claimId)!;
      if (
        oldClaim.id === newClaimId ||
        oldClaim.relation !== input.relation ||
        (oldClaim.from !== subject.id && oldClaim.to !== object.id) ||
        (oldClaim.validTo !== null && oldClaim.validTo !== requestedClaim.validTo) ||
        (oldClaim.validFrom !== null && oldClaim.validFrom >= requestedClaim.validTo) ||
        (input.validFrom !== undefined && requestedClaim.validTo > input.validFrom)
      ) {
        return error(
          'invalid_supersession',
          `Claim cannot be superseded as requested: ${oldClaim.id}`,
          { claimIds: [oldClaim.id] },
        );
      }
    }
    return undefined;
  }

  async #recalledClaim(
    executor: Executor,
    row: typeof claims.$inferSelect,
    subject: Entity,
    object: Entity,
    includeSources: boolean,
  ): Promise<RecalledClaim> {
    const sources = includeSources
      ? await executor
          .select()
          .from(claimSources)
          .where(eq(claimSources.claimId, row.id))
          .orderBy(asc(claimSources.recordedAt), asc(claimSources.conversationId))
      : undefined;
    return { ...toClaim(row), subject, object, sources };
  }
}
