# AMADEUS

AMADEUS 是一个受《命运石之门 0》中同名人工智能启发的具身 AI 项目，目标是构建
具有持续人格、长期记忆和自然交互能力的数字生命。

系统由四个部分组成：

- Agent 后端负责人格、推理、工具调用和运行生命周期；
- Live2D 前端负责形象、动作、表情和交互呈现；
- 实时语音系统负责低延迟聆听、回应和打断；
- 长期记忆负责维持跨越时间与 Conversation 的认知连续性。

当前仓库主要实现运行在 Bun 和 TypeScript 上的 AMADEUS Core，包括 Agent
Runtime、Conversation 持久化、结构化长期记忆，以及 Voice 和 Live2D Stage 的
基础通信边界。模型运行由 OpenAI Agents SDK 驱动，持久化使用 SQLite。

## AMADEUS Core

```text
Application
├── Agent + Runner
├── AmadeusRuntime
├── Conversations / ConversationSession
├── DatabaseMemory + OntologySnapshot
├── Voice
└── SQLite
```

`Application` 负责组装和关闭资源，对外提供用户 Turn、生命周期 Signal、运行中断、
Conversation 管理和历史查询。切换 Conversation 时会创建新的 Runtime，同时复用
Agent、数据库和长期记忆。

### Agent 与 Runtime

Agent 当前拥有五个工具：

- `say`
- `query_ontology`
- `remember`
- `recall`
- `forget`

用户可见文本只能通过 `say` 输出；Agent 完成内部工作后返回 `DONE`。工具调用串行
执行。

Runtime 保证同一时间只有一个 Agent run。新用户输入会中断旧任务，多个排队输入
只执行最新一个，忙碌时忽略生命周期 Signal。若运行正在发声，中断流程会等待语音
任务真正结束后再进行任务交接。当前可报告 `idle`、`thinking` 和 `speaking` 状态。

### Conversation

每个 Conversation 对应一个 SQLite Session，完整保存用户、助手和工具调用项目。
模型上下文与持久化历史相互独立：SQLite 保留完整历史，每次运行只向模型提供字符
预算内最近的完整 Turn，裁剪不会修改数据库数据。

Conversation 支持创建、打开、重命名、归档、恢复、列表和历史查询。归档当前
Conversation 时，应用会自动创建一个新的活动 Conversation。

### 长期记忆

长期记忆采用受本体约束的有向图：

```text
Entity ── Relation ──> Entity
```

本体由 `data/ontology.json` 声明，启动时经过严格校验并冻结为快照。Agent
工具中的实体类型和关系枚举直接从该快照生成。

当前实体类型：

- `person`
- `organization`
- `place`
- `activity`
- `concept`
- `artifact`

当前关系：

- `knows`
- `affiliated_with`
- `located_in`
- `involved_in`
- `interested_in`
- `prefers`
- `avoids`
- `owns`
- `created`
- `has_trait`
- `part_of`
- `broader_than`

实体可以通过 ID、类型与稳定 key，或类型与规范化 label/alias 解析。多候选结果会
明确返回歧义，不进行模糊猜测或自动合并。

Claim 保存首次记录时间、可选的现实有效区间和 Conversation 来源。重复写入相同
事实保持幂等；旧事实只能通过精确 Claim ID 显式结束。`recall` 提供有限、结构化的
一跳查询，多跳查询由 Agent 组合多次调用完成。`forget` 只删除指定 Claim、来源和
失去引用的普通实体，不删除原始 Conversation。

### 存储

SQLite 通过 Drizzle ORM 和版本化迁移管理，主要业务表包括：

- `sessions`
- `conversation_items`
- `entities`
- `entity_aliases`
- `claims`
- `claim_sources`

数据库启用了外键、busy timeout、WAL 和查询索引。记忆写入、事实修订和删除使用
事务。

### Voice 与 Stage

`Voice` 是 Agent 可见的窄接口。`CoreVoice` 可以消费流式 Synthesizer 输出，校验并
编码音频帧，通过 `StageLink` 发送音频与播放控制，并处理真实播放完成、中断、空
音频流、格式变化和 Stage 断开。

当前入口使用 `StageTextVoice`，将 `say` 内容同时输出到终端和 Stage 字幕。
`apps/stage` 提供 React、shadcn/ui 和 Tailwind CSS 构建的交互界面，通过本机
WebSocket 发送文本输入、Activity、字幕和打断命令。TTS、STT、音频设备和 Live2D
模型尚未接入。

## 当前边界

当前未实现向量检索、自然语言数据库查询、自动事实抽取、实体自动合并、事实冲突
推理、本体热更新、通用图路径查询、Conversation 隐私擦除，以及产生 timer、idle
或 network Signal 的外部调度器。

## 开发与运行

安装依赖：

```bash
bun install
```

复制 `.env.example` 为 `.env`，配置 `LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL`。
目标服务需要支持 Responses API。

运行类型检查和测试：

```bash
bun run typecheck
bun test
```

修改 `apps/amadeus/src/storage/schema.ts` 后生成数据库迁移：

```bash
bun run db:generate
```

迁移会在应用打开数据库时自动执行。

启动文本模式后端；每个非空标准输入行会成为一个 Turn：

```bash
bun start
```

Core 控制台会输出每次模型轮次、公开的思考摘要、工具选择与结果、模型回答、最终输出和
token 用量。工具参数和结果最多打印 4096 个字符。

开发时分别启动 Core 和 Stage。Vite 会将 `/ws` 代理到 Core 的默认 3000 端口：

```bash
bun start
bun run dev:stage
```

在 Stage URL 后添加 `?mock` 可以脱离 Core 独立预览。生产构建由 Core 在同一端口提供：

```bash
bun run build:stage
bun start
```

运行会产生模型费用的集成冒烟测试：

```bash
bun run smoke:llm
```
