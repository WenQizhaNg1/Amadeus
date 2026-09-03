# AMADEUS Memory：个人世界本体设计

> 状态：提案，待审阅。
>
> 范围：长期记忆的节点类型、关系约束、时序语义，以及本体向 Agent 的注入方式。
>
> 原则：底层保持一般图；Agent 只能通过一个小型、显式的本体读写记忆。

## 1. 目标

当前 Memory 已经具备最小的图结构：`Node` 表示事物，`Claim` 表示两个
节点之间的有向关系。但 `Node` 没有类型，`Claim.relation` 又是任意字符串，
因此 Agent 无法稳定地完成以下工作：

- 判断两段文本是否指向同一个节点；
- 判断一条关系是否合法；
- 构造范围明确、可重复的查询；
- 在新事实出现时识别旧事实；
- 把自然语言稳定映射成长期记忆。

本设计引入一个小型个人世界本体，作为 Agent 与 Memory 之间的协议：

```text
自然语言
   │
   ▼
Agent 选择本体中的节点类型与关系
   │
   ▼
remember / recall / forget
   │
   ▼
本体校验
   │
   ▼
宽松的 Node + Claim 图
```

本体不试图描述整个客观世界。它只描述个人 Agent 值得长期记住、并且需要
跨 Conversation 查询的信息。

## 2. 非目标

第一版不引入：

- RDF、OWL、SPARQL 或外部 ontology runtime；
- 自动学习和修改本体；
- 任意 relation；
- 通用世界知识图谱；
- embedding 或向量数据库；
- 置信度推理；
- 自动节点合并；
- 完整双时态数据库；
- 多跳图查询语言；
- 将完整本体重复写入全局提示词。

本体以什么格式持久化不是当前设计问题。实现可以先使用 TypeScript 常量；
关键要求是只有一个声明源，并能派生工具 schema 与运行时校验。

## 3. 核心模型

### 3.1 Node

第一版只有七种节点类型：

```ts
type NodeType =
  | 'person'
  | 'organization'
  | 'place'
  | 'activity'
  | 'concept'
  | 'artifact'
  | 'value';
```

| 类型 | 含义 | 示例 |
|---|---|---|
| `person` | 具体的人 | 用户、朋友、作者 |
| `organization` | 公司、团队、机构或社群 | OpenAI、某工作室 |
| `place` | 物理或虚拟地点 | 上海、GitHub |
| `activity` | 项目、任务、事件或习惯 | Amadeus、旅行、晨跑 |
| `concept` | 主题、技能、风格或特征 | 古典音乐、TypeScript、素食 |
| `artifact` | 具体作品或物品 | 一本书、软件、设备 |
| `value` | 无独立身份的字面值 | 日期、数字、文本、布尔值 |

`activity` 暂时合并 Project、Task、Event 与 Habit。只有真实查询证明这些类型
必须分开时，再扩展本体。

`value` 在 Agent 接口中表现为字面值；底层可以将它自动包装成节点：

```ts
{ value: 'Wenqi' }
{ value: '1998-01-01', datatype: 'date' }
```

### 3.2 实体身份

除 `value` 外，每个实体具有稳定身份与面向人的名称：

```ts
interface Entity {
  id: string;
  type: Exclude<NodeType, 'value'>;
  key: string;
  label: string;
  aliases: string[];
}
```

数据库保证 `(type, key)` 唯一：

```text
person:self
person:amadeus
place:shanghai
concept:classical-music
activity:amadeus-project
```

其中保留两个特殊身份：

```text
person:self       当前用户
person:amadeus    AMADEUS 自己
```

`key` 是规范身份；`label` 和 `aliases` 用于自然语言查找与 Wiki 展示。第一版
由 Memory 根据 label 生成规范 key，Agent 不生成数据库 ID。

这是一种最小实体解析策略。它不能自动判断“Wenqi”和“用户”是否为同一人；
特殊的 `person:self`、aliases 和后续人工合并承担这一职责。

### 3.3 Claim

Claim 是符合本体约束的有向关系：

```ts
interface Claim {
  id: string;
  from: string;
  relation: Relation;
  to: string;

  recordedAt: number;
  validFrom?: number;
  validTo?: number;

  source?: {
    conversationId: string;
    itemId?: number;
  };
}
```

本体负责约束 `from - relation -> to` 是否成立；时间与来源是所有 Claim 共享
的元数据，不作为普通关系塞进图中。

## 4. 关系词表

第一版本体只提供十二种关系：

```ts
type Relation =
  | 'knows'
  | 'affiliated_with'
  | 'located_in'
  | 'involved_in'
  | 'interested_in'
  | 'prefers'
  | 'avoids'
  | 'owns'
  | 'created'
  | 'has_trait'
  | 'part_of'
  | 'broader_than';
```

| Relation | From | To | 语义 |
|---|---|---|---|
| `knows` | person | person | 认识或具有稳定社会联系 |
| `affiliated_with` | person | organization | 工作、成员或其他稳定隶属关系 |
| `located_in` | person, organization, activity, artifact | place | 当前或指定时间位于某地 |
| `involved_in` | person, organization | activity | 参与项目、任务、事件或习惯 |
| `interested_in` | person | concept, activity, artifact | 对某领域感兴趣 |
| `prefers` | person | concept, activity, artifact, place, value | 持续性的正向偏好 |
| `avoids` | person | concept, activity, artifact, place, value | 厌恶、禁忌、过敏或主动规避 |
| `owns` | person, organization | artifact | 拥有某物 |
| `created` | person, organization | artifact, activity | 创作作品或发起活动 |
| `has_trait` | person, organization, activity, artifact | concept | 相对稳定的属性或特征 |
| `part_of` | organization, activity, concept, artifact | organization, activity, concept, artifact | 组成或归属关系 |
| `broader_than` | concept | concept | 概念的上下位关系 |

示例：

```text
person:self ──prefers────────> concept:concise-answers
person:self ──involved_in────> activity:amadeus-project
person:self ──avoids─────────> concept:wool
activity:amadeus-project ──part_of──> activity:personal-agent
concept:music ──broader_than─> concept:classical-music
```

第一版不提供 `related_to`、`has_property` 等万能关系。无法判断的信息如果被
压入万能关系，本体就无法帮助 Agent 收敛查询和写入。

无法表达的记忆应该被明确拒绝：

```json
{
  "error": "unsupported_ontology",
  "message": "No relation represents this claim."
}
```

真实出现且反复有价值的失败案例，才成为扩展本体的依据。

## 5. 时序语义

Claim 区分三个时间：

| 字段 | 含义 | 由谁提供 |
|---|---|---|
| `recordedAt` | AMADEUS 什么时候获知 | 系统自动生成 |
| `validFrom` | 现实中什么时候开始成立 | Agent 从用户表达中提取，可缺省 |
| `validTo` | 现实中什么时候停止成立 | Agent 提取或系统在事实被取代时设置 |

例如用户说“我 2020 到 2022 年住在北京”：

```ts
{
  from: 'person:self',
  relation: 'located_in',
  to: 'place:beijing',
  recordedAt: now,
  validFrom: '2020-01-01',
  validTo: '2022-12-31',
}
```

没有明确日期时不猜测 `validFrom`。`recordedAt` 也不能代替现实有效时间。

### 5.1 事实变化与遗忘

事实失效与用户要求遗忘是两个不同动作：

- 新事实取代旧事实：旧 Claim 保留，并设置 `validTo`；
- 用户明确要求忘记：物理删除指定 Claim，并清理不再被引用的孤立节点。

因此 `forget` 不是历史版本操作。它表达数据不应继续存在，不能通过
`forgottenAt` 软删除来模拟。

第一版不定义通用的自动矛盾检测。只有关系语义能够明确证明互斥时，
`remember` 才可以结束旧 Claim；其余情况允许多个 Claim 并存。

## 6. Agent 工具

Agent 只看到三个语义工具，不看到 `addNode`、`addClaim` 等存储操作。

### 6.1 remember

`remember` 一次记录一条符合本体的 Claim：

```ts
remember({
  subject: {
    type: 'person',
    key: 'self',
  },
  relation: 'prefers',
  object: {
    type: 'concept',
    label: '简洁直接的回答',
  },
  validFrom: '2026-09-03',
});
```

Memory 在一个事务中完成：

1. 解析或创建两端节点；
2. 校验节点类型与 relation 的 domain/range；
3. 查找完全相同的有效 Claim，保证工具重试幂等；
4. 在语义明确时结束被取代的旧 Claim；
5. 写入时间和当前 Conversation 来源；
6. 返回 Claim ID 与规范化后的完整三元组。

Agent 不提供 `id`、`recordedAt` 或 Conversation 来源。

### 6.2 recall

`recall` 是结构化的部分图查询：

```ts
recall({
  subject: {
    type: 'person',
    key: 'self',
  },
  relation: 'prefers',
  objectType: 'concept',
  at: '2026-09-03',
  limit: 10,
});
```

所有过滤条件可以独立缺省，但至少必须提供一个有效条件。第一版不允许无条件
导出整个记忆库，也不要求数据库理解完整自然语言问题。

查询结果包含：

- Claim ID；
- 两端节点的 ID、type、key、label；
- relation；
- 有效时间；
- 必要时的来源引用。

Agent 负责把用户语言映射到结构化查询；本体将可选关系和类型限制在有限集合。

### 6.3 forget

`forget` 只接受 `recall` 返回的精确 Claim ID：

```ts
forget({
  claimIds: ['claim_...'],
});
```

不接受自然语言删除条件：

```ts
forget({ query: '删除关于工作的一切' }); // 禁止
```

批量遗忘必须先 `recall`，再提交明确的 Claim ID 列表。

## 7. 本体如何注入 Agent

本体的主要注入位置是工具 JSON Schema，而不是全局提示词或 Skill。

```text
ontology declaration
       │
       ├──▶ remember / recall JSON Schema
       ├──▶ 工具字段描述与关系说明
       ├──▶ 运行时校验
       ├──▶ 查询构造
       └──▶ 测试与 Wiki 投影
```

工具 schema 应由本体生成，并尽可能表达每种 relation 的端点约束。例如选择
`involved_in` 后，只允许 `person | organization -> activity`。运行时仍必须使用
同一本体再次校验，工具 schema 不能成为安全边界。

全局 instructions 只保留稳定的使用纪律：

```text
Long-term memory follows the ontology exposed by the memory tools.

Remember only information likely to remain useful across conversations.
Do not invent node types or relations.
Do not force unsupported information into an approximate relation.
Recall before relying on prior personal knowledge.
Forget only claims that have been identified precisely.
Never store guesses as user beliefs or facts.
```

Skill 更适合以后表达复杂流程，例如整理访谈、处理冲突信念或生成个人 Wiki；
基础数据协议不应依赖 Agent 是否加载了某个 Skill。

## 8. 单一声明源

建议最终只有一个本体声明：

```ts
export const ontology = {
  nodeTypes: {
    person: {
      description: 'A concrete human individual.',
    },
    organization: {
      description: 'A company, team, institution, or community.',
    },
    // ...
  },

  relations: {
    prefers: {
      description: 'A persistent positive preference.',
      from: ['person'],
      to: ['concept', 'activity', 'artifact', 'place', 'value'],
    },
    involved_in: {
      description: 'Participation in a project, task, event, or habit.',
      from: ['person', 'organization'],
      to: ['activity'],
    },
    // ...
  },
} as const;
```

从它派生：

- TypeScript `NodeType` 与 `Relation`；
- `remember`、`recall` 的 JSON Schema；
- 数据库写入前的运行时校验；
- Agent 可见的类型与关系描述；
- 测试用例；
- 后续 indexed Markdown/Wiki 的分类与链接。

不得再维护第二份手写 relation enum、工具关系表或完整提示词副本。

## 9. 对现有实现的影响

本设计通过审阅后，实现预计涉及：

```text
apps/amadeus/src/memory/
  memory.ts             领域类型与 Memory 接口
  ontology.ts           单一本体声明与校验
  database-memory.ts    Drizzle 持久化与查询

apps/amadeus/src/tools/
  memory.ts             remember / recall / forget
```

数据库至少需要补充：

- Node 的 `type`、`key`、`label` 与 aliases；
- `(type, key)` 唯一约束；
- Claim 的 `validFrom`、`validTo` 和来源；
- relation、时间及两端节点的查询索引。

`Memory` 公开语义操作；底层 Node/Claim CRUD 不暴露给 Agent。`Memory` 通过
`AmadeusContext` 注入工具，Agent 继续由 Agents SDK 的 Runner 驱动，不新增
Memory Engine、Tool Registry 或第二套 Agent loop。

## 10. 设计依据

本设计借鉴但不直接实现以下模型：

- PIMO：以当前用户为中心组织人物、项目、主题和个人信息；
- SKOS：`prefLabel`、`altLabel` 与概念上下位关系；
- Graphiti/Zep：Entity、Fact、Episode，以及事实有效时间；
- PROV-O：事实来源与推导来源应当可追踪；
- OWL-Time：区分时间点、有效区间与记录时间。

参考：

- https://github.com/getzep/graphiti
- https://arxiv.org/abs/2501.13956
- https://www.w3.org/TR/skos-reference/
- https://www.w3.org/TR/prov-o/
- https://www.w3.org/TR/owl-time/
- https://xmlns.com/foaf/spec/
- https://schema.org/

我们只采用其中对当前问题必要的语义，不引入它们的存储格式、查询语言或
完整类型系统。

## 11. 待审阅决策

在进入实现前，需要确认以下边界：

1. 是否接受以 `person / organization / place / activity / concept / artifact / value`
   作为 v0 的全部节点类型；
2. 是否接受十二种初始 relation，并拒绝万能 `related_to`；
3. 是否接受 Project、Task、Event 与 Habit 暂时合并为 `activity`；
4. 是否接受 `forget` 物理删除，而事实变化通过 `validTo` 表达；
5. 是否接受 Agent 不生成节点 ID，实体由 `(type, key)` 规范定位；
6. 是否接受第一版 `recall` 仅做结构化查询，不加入 embedding 和自然语言搜索。

以上决策通过后，再制定数据库迁移与工具接入计划。
