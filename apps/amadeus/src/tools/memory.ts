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

function parseInput<T>(
  toolName: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new TypeError(
      `${toolName} 工具参数无效：\n${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }
  return result.data;
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
  const selectorDescription =
    '实体选择器，必须传对象。已有实体可用 {"id":"实体 ID"}；已知稳定键时可用 {"type":"实体类型","key":"稳定键"}，当前用户和 AMADEUS 的稳定键分别是 self 和 amadeus；按名称选择时使用 {"type":"实体类型","label":"名称"}。';

  const selectorJson = {
    description: selectorDescription,
    oneOf: [
      {
        type: 'object',
        description: '按已有实体 ID 精确选择。',
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: '已有实体的 ID。',
          },
        },
        required: ['id'] as string[],
        additionalProperties: false,
      },
      {
        type: 'object',
        description: '按实体类型和稳定键精确选择已有实体。',
        properties: {
          type: {
            type: 'string',
            enum: typeEnum,
            description: '本体中定义的实体类型。',
          },
          key: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description:
              '已有实体的稳定键。当前用户使用 self，AMADEUS 使用 amadeus。',
          },
        },
        required: ['type', 'key'] as string[],
        additionalProperties: false,
      },
      {
        type: 'object',
        description: '按实体类型和名称选择；remember 可在不存在时创建该实体。',
        properties: {
          type: {
            type: 'string',
            enum: typeEnum,
            description: '本体中定义的实体类型。',
          },
          label: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: '用户可识别的实体名称。',
          },
        },
        required: ['type', 'label'] as string[],
        additionalProperties: false,
      },
    ],
  } as const;

  const rememberParameters = {
    type: 'object',
    properties: {
      subject: {
        ...selectorJson,
        description: `声明的主体。${selectorDescription}`,
      },
      relation: {
        type: 'string',
        enum: relationEnum,
        description: '本体中定义的关系。含义或端点不清楚时先调用 query_ontology。',
      },
      object: {
        ...selectorJson,
        description: `声明的客体。${selectorDescription}`,
      },
      validFrom: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: '该声明开始成立的日期，格式为 YYYY-MM-DD。',
      },
      validTo: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: '该声明不再成立的日期，格式为 YYYY-MM-DD。',
      },
      supersedes: {
        type: 'array',
        maxItems: 20,
        description: '被新声明取代的旧声明及其结束日期。使用前先 recall 旧声明。',
        items: {
          type: 'object',
          properties: {
            claimId: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              description: '被取代声明的 ID。',
            },
            validTo: {
              type: 'string',
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              description: '旧声明的结束日期，格式为 YYYY-MM-DD。',
            },
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
        description: '要精确查询的声明 ID。不能与图查询条件同时使用。',
      },
      subject: {
        ...selectorJson,
        description: `按声明主体筛选。${selectorDescription}`,
      },
      subjectType: {
        type: 'string',
        enum: typeEnum,
        description: '仅按声明主体的实体类型筛选。',
      },
      relation: {
        type: 'string',
        enum: relationEnum,
        description: '按本体中定义的关系筛选。',
      },
      object: {
        ...selectorJson,
        description: `按声明客体筛选。${selectorDescription}`,
      },
      objectType: {
        type: 'string',
        enum: typeEnum,
        description: '仅按声明客体的实体类型筛选。',
      },
      at: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: '查询在指定日期成立的声明，格式为 YYYY-MM-DD。',
      },
      includeHistorical: {
        type: 'boolean',
        description: '是否包含已经结束的历史声明。不能与 at 同时使用。',
      },
      includeSources: {
        type: 'boolean',
        description: '是否返回声明的来源信息。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: '最多返回的声明数量，范围为 1 到 100。',
      },
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
          message: 'claimIds 不能与图查询条件同时使用。',
        });
      }
      if (!value.claimIds && graphFilters.every((item) => item === undefined)) {
        refinement.addIssue({
          code: 'custom',
          message: 'recall 需要 claimIds 或至少一个图查询条件。',
        });
      }
      if (value.at && value.includeHistorical) {
        refinement.addIssue({
          code: 'custom',
          message: 'at 与 includeHistorical 不能同时使用。',
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
        description: '要删除的声明 ID，必须来自 recall 的结果。',
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
仅在信息经过用户确认、适合跨对话长期保留且准确符合本体时，存储一条声明。普通问候和
临时对话无需记录。取代旧声明前先 recall。不要存储秘密或猜测。
`.trim(),
    parameters: rememberParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      const ctx = context(runContext?.context);
      return await ctx.memory.remember(parseInput('remember', rememberInput, value), {
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
当前问题确实需要以往的个人信息时，对长期记忆执行一次有界的结构化边查询。普通问候
通常无需查询。多跳问题需要显式组合多次调用。
`.trim(),
    parameters: recallParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      return await context(runContext?.context).memory.recall(
        parseInput('recall', recallInput, value),
      );
    },
  });

  const forgetTool = tool<typeof forgetParameters, AmadeusContext, ForgetResult>({
    name: 'forget',
    description: `
删除 recall 返回的指定长期记忆声明。此操作不会删除原始会话、备份或日志。
`.trim(),
    parameters: forgetParameters,
    strict: false,
    errorFunction: null,
    async execute(value, runContext) {
      return await context(runContext?.context).memory.forget(
        parseInput('forget', forgetInput, value),
      );
    },
  });

  return { rememberTool, recallTool, forgetTool };
}
