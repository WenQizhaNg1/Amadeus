import { tool } from '@openai/agents';
import { z } from 'zod';

import type { AmadeusContext } from '../agent/context.ts';
import type {
  ForgetResult,
  MemoryError,
  RecallResult,
  RememberResult,
} from '../memory/memory.ts';
import type { OntologySnapshot } from '../memory/ontology.ts';

function context(required: AmadeusContext | undefined): AmadeusContext {
  if (!required) throw new Error('Memory tools require an Amadeus run context.');
  return required;
}

export function createMemoryTools(snapshot: OntologySnapshot) {
  const typeEnum = snapshot.entityTypes;
  const relationEnum = snapshot.relations;
  const id = z.string().trim().min(1).max(128);
  const type = z.enum(typeEnum as [string, ...string[]]);
  const relation = z.enum(relationEnum as [string, ...string[]]);
  const selector = z.union([
    z.strictObject({ id }),
    z.strictObject({ type, key: z.string().trim().min(1).max(128) }),
    z.strictObject({ type, label: z.string().trim().min(1).max(200) }),
  ]);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const supersession = z.strictObject({ claimId: id, validTo: date });

  const selectorJson = {
    oneOf: [
      {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1, maxLength: 128 } },
        required: ['id'] as string[],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', enum: typeEnum },
          key: { type: 'string', minLength: 1, maxLength: 128 },
        },
        required: ['type', 'key'] as string[],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { type: 'string', enum: typeEnum },
          label: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['type', 'label'] as string[],
        additionalProperties: false,
      },
    ],
  } as const;

  const rememberParameters = {
    type: 'object',
    properties: {
      subject: selectorJson,
      relation: { type: 'string', enum: relationEnum },
      object: selectorJson,
      validFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      validTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      supersedes: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string', minLength: 1, maxLength: 128 },
            validTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
          required: ['claimId', 'validTo'] as string[],
          additionalProperties: false,
        },
      },
    },
    required: ['subject', 'relation', 'object'] as string[],
    additionalProperties: true,
  } as const;
  const rememberInput = z.strictObject({
    subject: selector,
    relation,
    object: selector,
    validFrom: date.optional(),
    validTo: date.optional(),
    supersedes: z.array(supersession).max(20).optional(),
  });

  const recallParameters = {
    type: 'object',
    properties: {
      claimIds: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { type: 'string', minLength: 1, maxLength: 128 },
      },
      subject: selectorJson,
      subjectType: { type: 'string', enum: typeEnum },
      relation: { type: 'string', enum: relationEnum },
      object: selectorJson,
      objectType: { type: 'string', enum: typeEnum },
      at: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      includeHistorical: { type: 'boolean' },
      includeSources: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: [] as string[],
    additionalProperties: true,
  } as const;
  const recallInput = z
    .strictObject({
      claimIds: z.array(id).min(1).max(50).optional(),
      subject: selector.optional(),
      subjectType: type.optional(),
      relation: relation.optional(),
      object: selector.optional(),
      objectType: type.optional(),
      at: date.optional(),
      includeHistorical: z.boolean().optional(),
      includeSources: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .superRefine((value, refinement) => {
      const graphFilters = [
        value.subject,
        value.subjectType,
        value.relation,
        value.object,
        value.objectType,
      ];
      if (value.claimIds && graphFilters.some((item) => item !== undefined)) {
        refinement.addIssue({
          code: 'custom',
          message: 'claimIds cannot be combined with graph filters.',
        });
      }
      if (!value.claimIds && graphFilters.every((item) => item === undefined)) {
        refinement.addIssue({
          code: 'custom',
          message: 'Recall requires claimIds or a graph filter.',
        });
      }
      if (value.at && value.includeHistorical) {
        refinement.addIssue({
          code: 'custom',
          message: 'at and includeHistorical are mutually exclusive.',
        });
      }
    });

  const forgetParameters = {
    type: 'object',
    properties: {
      claimIds: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
    required: ['claimIds'] as string[],
    additionalProperties: true,
  } as const;
  const forgetInput = z.strictObject({ claimIds: z.array(id).min(1).max(50) });

  const rememberTool = tool<
    typeof rememberParameters,
    AmadeusContext,
    RememberResult | MemoryError
  >({
    name: 'remember',
    description: `
Store one durable, user-confirmed claim that exactly fits the ontology. Recall
an old claim before superseding it. Never store secrets or guesses.
`.trim(),
    parameters: rememberParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      const ctx = context(runContext?.context);
      return await ctx.memory.remember(rememberInput.parse(value), {
        conversationId: ctx.conversationId,
        now: () => ctx.now(),
      });
    },
  });

  const recallTool = tool<
    typeof recallParameters,
    AmadeusContext,
    RecallResult | MemoryError
  >({
    name: 'recall',
    description: `
Run one bounded, structured edge query over long-term memory. Compose multiple
calls explicitly for multi-hop questions.
`.trim(),
    parameters: recallParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      return await context(runContext?.context).memory.recall(
        recallInput.parse(value),
      );
    },
  });

  const forgetTool = tool<typeof forgetParameters, AmadeusContext, ForgetResult>({
    name: 'forget',
    description: `
Delete exact long-term-memory claim IDs returned by recall. This does not
delete the original Conversation, backups, or logs.
`.trim(),
    parameters: forgetParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      return await context(runContext?.context).memory.forget(
        forgetInput.parse(value),
      );
    },
  });

  return { rememberTool, recallTool, forgetTool };
}
