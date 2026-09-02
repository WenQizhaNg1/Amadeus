# AMADEUS Core：生命周期、Conversation、上下文与身份设计

> 状态：已实施，并通过真实 OpenAI-compatible 模型 smoke。
>
> 范围：应用启动与关闭、上下文长度管理、持续身份/人格、Conversation 生命周期。
>
> 原则：保持 Runtime 薄；只使用 Agents SDK 已有原语；完整历史与模型上下文分离；不提前实现 Memory、Embedding、Stage 或语音模型。

## 1. 目标

当前 AMADEUS 已经具备一条经过真实 OpenAI-compatible 模型验证的基本链路：

```text
Model → Agent / Runner → say → Voice boundary
                     ↘ SQLite Session
```

这些缺口现已补齐：core 由正式应用层管理生命周期，SQLite 永久保存完整历史但只向模型回放近期窗口，Identity 稳定进入 Agent instructions，Conversation 具备创建、恢复、查询和归档语义。

本设计要使 core 达到以下状态：

- 应用启动后可以恢复最近的 Conversation；
- Model、Runner、数据库和 Runtime 有明确的所有者与关闭顺序；
- SQLite 永久保存完整历史，模型只接收受限的近期上下文；
- AMADEUS 的身份与核心协议稳定进入每轮 instructions；
- Conversation 可以创建、列出、恢复、重命名和归档；
- 仍然只有 Agents SDK 负责模型与 Tool Loop。

## 2. 非目标

本轮不实现：

- 长期 Memory、Fact 提取或 Embedding；
- 对历史进行 LLM 摘要；
- 模型服务商提供的服务端 Conversation；
- provider-specific compaction；
- STT、TTS 模型和 turn detector；
- Stage WebSocket 服务；
- 多进程主从协调；
- 通用配置框架、DI container 或 Repository interface；
- 自动生成 Conversation 标题；
- Identity 编辑器或 Identity 数据库。

## 3. 总体结构

```text
                       start()
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
  identity.md        injected Model        SQLite
       │                  │                  │
       ▼                  ▼                  ▼
  createAgent()         Runner       SQLiteConversations
       │                  │                  │
       └──────────┬───────┘            SQLiteSession
                  │                         │
                  ▼                  完整历史永久归档
           AmadeusRuntime                   │
                  ▲                         ▼
                  │                 ContextWindow 选取
             injected Voice                 │
                                            ▼
                                       模型近期上下文
```

新增的应用层只负责资源所有权和 Conversation 切换，不参与 Agent Loop：

```text
Amadeus
  ├─ uses injected Model
  ├─ owns Runner
  ├─ owns SQLite database
  ├─ owns current Conversation / SQLiteSession
  └─ owns current AmadeusRuntime

Agents SDK
  └─ owns model → tool → model loop
```

Provider 是组合根的实现细节，不属于 AMADEUS core：

```text
bootstrap / smoke
  └─ API key + base URL + protocol choice
       └─ ModelProvider
            └─ Model ──inject──▶ Amadeus
```

Core 只依赖 Agents SDK 的 `Model` 接口，不读取 API key，不创建
`OpenAIProvider`，也不判断一个端点使用 Responses 或 Chat Completions。

## 4. 四个概念必须分开

| 概念 | 职责 | 是否发送给模型 |
|---|---|---|
| `Identity` | AMADEUS 是谁、行为原则和表达风格 | 每轮作为 instructions |
| `Conversation` | 一段完整、可查询和归档的交互记录 | 不直接全部发送 |
| `Session` | Agents SDK 的历史存储接口 | 经上下文窗口选择后发送 |
| `Memory` | Agent 主动提取的跨 Conversation 事实 | 本轮不实现 |

### 4.1 Identity 不是 Memory

Identity 是规范性信息：

- 她是谁；
- 她如何表达；
- 她和用户是什么关系；
- 哪些行为原则不能违反。

Memory 是经验性信息：

- 用户偏好；
- 曾发生的事件；
- Agent 从历史中主动总结的事实。

Identity 不应随着一次对话自动变化；Memory 以后可以由 Agent 更新。

### 4.2 Conversation 不是模型上下文

Conversation 是完整历史。模型上下文只是其中当前需要回放的窗口：

```text
SQLite Conversation: Turn 1  ... Turn 480 ... Turn 500
Model context:                       Turn 480 ... Turn 500
```

裁剪模型输入不能删除归档记录。

### 4.3 Conversation 与 Session 一一对应

一个 Conversation 对应一个 Agents SDK Session：

```text
Conversation.id === SQLiteSession.sessionId
```

不再定义第二种 Session。Conversation 负责产品生命周期，`SQLiteSession` 只实现 SDK 接口。

## 5. 应用启动与生命周期

### 5.1 应用边界

新增：

```text
apps/amadeus/src/application.ts
```

提供一个很薄的 `Amadeus` 接口；具体实现不暴露构造器，只能通过
`start()` 获得：

```ts
export interface Amadeus {
  readonly activity: Activity;
  readonly conversation: Conversation;

  turn(text: string): Promise<void>;
  wake(signal: Signal): Promise<void>;
  interrupt(): Promise<void>;

  create(): Promise<Conversation>;
  open(id: string): Promise<Conversation>;
  rename(id: string, title: string): Promise<void>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  list(options?: { includeArchived?: boolean }): Promise<Conversation[]>;
  history(id: string, limit?: number): Promise<AgentInputItem[]>;

  close(): Promise<void>;
}
```

它不实现模型循环，也不解释 Tool Call。普通 Turn 仍然委托给 `AmadeusRuntime`。

公开名称遵循两条规则：

- 不重复接收者已经表达的上下文，例如使用 `app.open(id)`，而不是
  `app.resumeConversation(id)`；
- 不用缩写，也不为了短而牺牲含义，例如仍保留 `interrupt()` 和
  `conversation`，不改成 `stop()` 或 `conv`。

### 5.2 启动参数

`Amadeus` 接收一个已经构造好的 Agents SDK `Model`：

```ts
import type { Model } from '@openai/agents';
import type { Voice } from './voice/voice.ts';

export interface StartOptions {
  model: Model;
  voice: Voice;
  databasePath: string;
  identityPath: string;
  contextChars: number;
}

const app = await start(options);
```

`start()` 不依赖 `Bun.env`，也不接收 `apiKey`、`baseURL`、模型名称或
Provider 配置。可执行入口或 smoke 脚本负责从 `.env` 创建具体 Provider，
再把 `Model` 传入：

```ts
const provider = new OpenAIProvider({
  apiKey: Bun.env.LLM_API_KEY,
  baseURL: Bun.env.LLM_BASE_URL,
  // Responses / Chat Completions 的选择也只在组合根配置。
});

const model = await provider.getModel(requiredEnvironment('LLM_MODEL'));
const app = await start({ model, databasePath, identityPath, contextChars, voice });

try {
  // use app
} finally {
  await app.close();
  await provider.close();
}
```

这样：

- secret 不进入 core 对象或错误输出；
- 单元测试可以直接传入假 `Model`；
- 任意 Provider 都可以接入，不限于 OpenAI-compatible 服务；
- OpenAI-compatible 服务继续复用 SDK 的 `OpenAIProvider`；
- API 格式差异由 Provider 处理，不进入 AMADEUS；
- 不产生通用配置系统。

`Model` 和创建它的 Provider 由调用者拥有；`app.close()` 不关闭注入对象。
这避免要求通用 `Model` 具备 SDK 并未定义的 `close()` 方法。

为保持 Chat Completions 与 Responses 两条 OpenAI-compatible 路径都可用，
core 不启用只属于 Responses 的 Tool `outputSchema`，也不要求结构化 final
output。`say` 仍返回 `{ status }`，Agent 完成时只输出被 Runtime 忽略的
普通文本标记 `DONE`。

### 5.3 启动顺序

```text
receive Model
  ↓
load identity
  ↓
open and migrate SQLite
  ↓
resume latest unarchived Conversation or create one
  ↓
create one Runner with tracing disabled
  ↓
create Agent with injected Model + identity
  ↓
create SQLiteSession
  ↓
create AmadeusRuntime
  ↓
return Amadeus
```

Runner 和 Agent 在整个应用生命周期中只创建一次。切换 Conversation 时只替换 Session 和 Runtime。Model 始终复用，其生命周期由调用者管理。

### 5.4 关闭顺序

```text
reject new work
  ↓
interrupt active Turn
  ↓
await Runner and Utterance settlement
  ↓
close SQLite
```

`close()` 必须幂等，且数据库关闭后不能再接受 Turn 或 Conversation 操作。
它不关闭调用者注入的 `Model` 或 Provider。

### 5.5 可执行入口与进程关闭

正式组合根位于：

```text
apps/amadeus/src/main.ts
```

它从 `.env` 读取 `LLM_*` 和可选的 `AMADEUS_*` 配置，创建通用
`OpenAIProvider`，取得 `Model` 后调用 `start()`。当前入口是语音接入前的文本调试模式：stdin 每个非空行形成一个 Turn，stdout 充当临时 Voice。

EOF、`SIGINT` 和 `SIGTERM` 使用同一条幂等关闭路径：

```text
stop accepting stdin
  ↓
await app.close()
  ↓
await provider.close()
```

信号处理器只在 `start()` 成功后安装，避免启动中途关闭 Provider、随后遗留新建 Application 的竞态。Application 仍只关闭自己拥有的 Runtime 和 SQLite；Provider 始终由组合根关闭。

### 5.6 Runtime interruption API

可靠关闭和 Conversation 切换都需要等待 Runtime 清理完成。因此将：

```ts
interrupt(): void;
```

调整为：

```ts
interrupt(): Promise<void>;
```

调用时仍同步发出 Voice interruption 和 AbortSignal；返回的 Promise 只表示当前 handoff 已完成。实时 UI 不需要等待时可以：

```ts
void app.interrupt();
```

应用关闭或切换 Conversation 时必须 `await`。

## 6. Conversation 生命周期

### 6.1 数据结构

沿用现有 `sessions` 表，不为了改名重建一套表。数据库升级到 version 2：

```sql
ALTER TABLE sessions ADD COLUMN title TEXT;
ALTER TABLE sessions ADD COLUMN updated_at INTEGER;
ALTER TABLE sessions ADD COLUMN archived_at INTEGER;

UPDATE sessions
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE INDEX sessions_active_updated_at
ON sessions(archived_at, updated_at DESC);
```

迁移完成后，应用代码把 `updated_at` 视为必有值。是否通过 SQLite 重建表增加 `NOT NULL` 约束，在实现时以最小迁移复杂度决定；不能丢失已有 Conversation。

领域对象：

```ts
export interface Conversation {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}
```

### 6.2 具体实现

新增：

```text
apps/amadeus/src/conversation/conversation.ts
apps/amadeus/src/conversation/sqlite-conversations.ts
```

不增加 Repository interface 或 `ConversationManager`。`SQLiteConversations` 直接提供：

```ts
create(): Promise<Conversation>;
get(id: string): Promise<Conversation | undefined>;
list(options?: { includeArchived?: boolean }): Promise<Conversation[]>;
latest(): Promise<Conversation | undefined>;
rename(id: string, title: string): Promise<void>;
archive(id: string): Promise<void>;
unarchive(id: string): Promise<void>;
```

`create()` 使用 `crypto.randomUUID()`，也允许测试注入 ID 和时钟。

### 6.3 最近 Conversation

启动时选择：

```sql
WHERE archived_at IS NULL
ORDER BY updated_at DESC, created_at DESC, rowid DESC
LIMIT 1
```

`rowid` 只用于解决同一毫秒内创建或更新产生的并列，不进入领域对象。

没有可恢复 Conversation 时创建一个新的。

不维护单独的 `current_conversation_id`。单用户、单进程场景中，最近活动且未归档的 Conversation 就是恢复目标。

### 6.4 更新时间

`SQLiteSession.addItems()` 在追加历史的同一数据库事务中更新：

```sql
UPDATE sessions
SET updated_at = ?
WHERE id = ?;
```

这样 Conversation 排序与真实持久化顺序一致，不依赖 Runtime 额外调用 `touch()`。

`clearSession()` 只清空 items，不删除 Conversation 元数据。

### 6.5 创建与恢复

切换 Conversation 必须串行执行：

```text
await current Runtime interruption / settlement
  ↓
resolve target Conversation
  ↓
create SQLiteSession(target.id)
  ↓
create new AmadeusRuntime with same Runner / Agent / Voice
  ↓
publish new current Conversation
```

Conversation 操作期间拒绝新的 `turn()`，并忽略新的 `wake()`；不能让一个
Turn 在旧 Session 开始、在新 Session 完成。调用者应先 `await` 操作完成。

### 6.6 归档

归档非当前 Conversation 只更新 `archived_at`。

归档当前 Conversation：

1. 等待当前 Turn settle；
2. 更新 `archived_at`；
3. 创建一个新 Conversation；
4. 为新 Conversation 重建 Runtime；
5. Model、Runner、Agent、Voice 和数据库保持复用。

恢复已归档 Conversation 必须先显式调用 `unarchive()`；普通 `open()` 不隐式改变归档状态。

### 6.7 标题

标题允许为空，并只提供显式 `rename()`。本轮不额外调用 LLM 自动生成标题，避免增加隐藏费用和后台行为。

### 6.8 历史查询

`history(id, limit?)` 直接读取指定 Conversation 的持久化 items，而不是模型裁剪后的上下文：

- active 与 archived Conversation 都可查询；
- `limit` 返回最新 N 项，同时保持正序；
- 未知 ID 抛出 `ConversationNotFoundError`；
- 查询不会隐式创建、恢复或反归档 Conversation。

## 7. 上下文长度管理

### 7.1 使用 SDK 原生入口

当前安装的 Agents SDK 提供：

```ts
type SessionInputCallback = (
  historyItems: AgentInputItem[],
  newItems: AgentInputItem[],
) => AgentInputItem[] | Promise<AgentInputItem[]>;
```

它只改变本轮发给模型的 items，不改变 Session 中保存的历史。因此 `AmadeusRuntimeOptions` 增加并原样转发：

```ts
sessionInputCallback?: SessionInputCallback;
```

不创建新的 Session wrapper，也不让 `SQLiteSession.getItems()` 隐式返回不完整历史。

### 7.2 ContextWindow

新增：

```text
apps/amadeus/src/conversation/context-window.ts
```

提供普通函数：

```ts
export function selectRecentContext(
  historyItems: AgentInputItem[],
  newItems: AgentInputItem[],
  maxHistoryChars: number,
): AgentInputItem[];
```

它不是 class，也不维护状态。

### 7.3 选择算法

```text
输入：完整 historyItems + 当前 newItems
  ↓
按 user/system 输入识别 Turn 起点
  ↓
把历史切分为完整 Turn
  ↓
从最新 Turn 向前累加序列化字符数
  ↓
加入预算内的完整 Turn
  ↓
append 当前 newItems
```

规则：

1. `newItems` 永远完整保留，不静默截断当前用户输入；
2. 从最新 Turn 向前选取；
3. 不从 Tool Call 与 Tool Result 中间切断；
4. 不从一个历史 Turn 中间切断；
5. 至少保留最近一个完整历史 Turn；
6. 更早历史只是不发送给模型，仍保留在 SQLite；
7. Signal 形成的 system input 也视为 Turn 起点；
8. 空历史直接返回 `newItems`。

### 7.4 为什么使用字符预算

不同模型和语言的 tokenizer 不同。为任意注入模型绑定某个特定 tokenizer
会产生虚假的精确度。

v0.1 使用：

```ts
JSON.stringify(item).length
```

作为可预测的保守成本。应用层显式传入预算，例如：

```ts
contextChars: 48_000
```

该预算只覆盖 Session history，不包含 instructions、Tool schema 和本轮输入，因此天然留出一部分余量。真实阈值由组合根根据所用模型窗口和观测结果调整。

### 7.5 超大单 Turn

如果最近一个历史 Turn 本身超过预算，仍完整保留该 Turn；不静默截断 Tool 语义。

如果当前 `newItems` 本身超过模型上限，让 Model 返回明确错误。本轮不实现自动拆分用户输入。

### 7.6 暂不使用 compaction

OpenAI 官方 compaction 可以返回携带先前状态的不透明 compaction item，当前 Agents SDK 也提供相关 Session 扩展点。但本轮不使用，原因是：

- 并非所有注入模型或 Provider 都支持相同的 compaction 语义；
- 不透明 item 不适合作为用户可阅读的 Conversation archive；
- 本地窗口选取已经能解决请求无限增长问题；
- 摘要和 Memory 需要单独设计事实保真策略。

未来若加入 compaction，它只能替换“模型输入窗口”，不能覆盖 SQLite 中的原始 Conversation。

## 8. 持续身份与人格

### 8.1 存储位置

新增：

```text
apps/amadeus/identity.md
```

该文件随 AMADEUS 系统一起存放在 USB 上，可版本控制，不包含 API key。它是当前正式 Identity 的唯一来源。

Identity 文件保存：

- 名称与自我认知；
- 与用户的关系定位；
- 语言、语气和表达偏好；
- 主动行为倾向；
- 不属于协议安全规则的角色边界。

### 8.2 Core rules 与 Identity 分离

`agent.ts` 保留不可被 Identity 覆盖的协议规则：

```text
say 是唯一用户可感知的语言输出
raw final output 不展示给用户
Turn 完成时返回内部 `DONE` 标记
Signal 可以选择沉默
```

Agent instructions 按固定顺序组成：

```text
core protocol instructions

Identity
--------
contents of identity.md
```

协议规则放在前面，并在 Identity 之前明确其优先级。

### 8.3 Agent factory

当前单例 Agent 改为显式 factory：

```ts
export function createAgent(options: {
  model: Model;
  identity: string;
}): AmadeusAgent;
```

模型选择和 Identity 在应用启动时确定。整个进程复用同一个 Agent，不在每轮重新读取文件。

使用静态 instructions，而不是 dynamic instructions callback。Identity 修改在下次应用启动时生效，避免同一个运行周期内人格突然漂移。

### 8.4 加载失败

- 文件不存在：启动失败并指出路径；
- 文件为空或只有空白：启动失败；
- 不回退到一个隐藏的通用人格；
- 错误信息不得包含 `.env` 或其他 secret。

## 9. 移除未实现的 Memory 占位

本轮不实现 Memory，而当前 `AmadeusContext.memory` 没有消费者，只迫使测试和启动代码创建假实现。

遵循与 Host 相同的 KISS 规则：

- 从 `AmadeusContext` 删除 `memory`；
- 删除 `memory/memory.ts`；
- 从公共 API 删除 `Memory`、`MemoryItem` 和 `NewMemoryItem`；
- 清理测试与 smoke 中的 dummy Memory；
- 同步修改主设计文档，把 Memory 标记为后续阶段，而不是 v0.1 当前实现。

未来真正开始 Fact/Embedding 时，根据实际 Tool 和检索路径重新引入。

## 10. 建议目录

```text
apps/amadeus/
├─ identity.md
├─ scripts/
│  └─ smoke-llm.ts
└─ src/
   ├─ main.ts
   ├─ application.ts
   ├─ agent.ts
   ├─ amadeus.ts
   ├─ context.ts
   ├─ conversation/
   │  ├─ conversation.ts
   │  ├─ context-window.ts
   │  ├─ sqlite-conversations.ts
   │  ├─ sqlite-conversations.test.ts
   │  ├─ sqlite-session.ts
   │  └─ sqlite-session.test.ts
   ├─ storage/
   │  ├─ sqlite.ts
   │  └─ sqlite.test.ts
   ├─ tools/
   │  └─ say.ts
   └─ voice/
```

明确不增加：

```text
ApplicationManager
ConversationManager
IdentityEngine
ContextEngine
Repository<T>
DIContainer
```

## 11. 实施顺序

### 阶段一：Conversation 数据模型

1. 数据库迁移到 version 2；
2. 增加 Conversation 元数据列和索引；
3. 实现 `SQLiteConversations`；
4. 让 `SQLiteSession.addItems()` 同事务更新 `updated_at`；
5. 覆盖从 version 1 升级且不丢历史的测试。

### 阶段二：上下文窗口

1. 实现纯函数 `selectRecentContext()`；
2. 覆盖空历史、预算边界、多 Turn、Tool Call/Result 完整性；
3. Runtime 原样转发 `sessionInputCallback`；
4. 验证 SQLite history 数量不会因裁剪改变。

### 阶段三：Identity

1. 增加 `identity.md`；
2. 实现读取和空值检查；
3. 把 Agent 单例改为 `createAgent()`；
4. 验证 core rules 与 Identity 都进入 instructions；
5. 删除未实现的 Memory 占位。

### 阶段四：Amadeus

1. 实现 `start()`，组装注入的 Model、Runner、Agent 和本地资源；
2. Runtime interruption 返回可等待的 Promise；
3. 实现最近 Conversation 恢复；
4. 实现新建、切换和归档当前 Conversation；
5. 实现幂等关闭；启动失败时只清理 AMADEUS 自己打开的资源。

### 阶段五：真实验证

1. smoke 在组合根创建 `OpenAIProvider` 和 `Model`，core 改用 `start()`；
2. 首轮写入后关闭整个应用；
3. 第二次启动自动恢复同一 Conversation；
4. 第二轮准确回忆首轮随机短语；
5. 确认 Runner tracing 仍关闭；
6. 运行全量单元测试、类型检查和 `git diff --check`。

### 阶段六：正式入口与回归收尾

1. 恢复 Runtime 抢占、打断、Activity 和失败恢复的关键回归测试；
2. 增加 Conversation `history()` 查询；
3. 增加正式 `main.ts` 文本入口；
4. 验证 Application 先于 Provider 关闭，且信号处理器可以移除。

## 12. 测试设计

### 12.1 数据库迁移

- 全新数据库直接得到 version 2；
- version 1 数据库升级后，旧 Session 和 items 全部存在；
- `updated_at` 正确回填为 `created_at`；
- 重复执行 migration 幂等；
- 新版本数据库仍被拒绝。

### 12.2 Conversation

- 首次启动创建 Conversation；
- 重启恢复最近未归档 Conversation；
- list 默认排除已归档项；
- rename 不改变历史；
- archive 不删除历史；
- history 可读取 active 与 archived Conversation，并支持最新 N 项；
- history 不会为未知 ID 创建 Conversation；
- 归档当前 Conversation 后自动切换到新 Conversation；
- 不允许普通 `open()` 隐式恢复已归档项。

### 12.3 上下文窗口

- 无历史时只返回新 input；
- 预算足够时返回完整历史；
- 超限时只删除完整的旧 Turn；
- Tool Call 与 Tool Result 保持在同一窗口；
- 最近单 Turn 超限时仍整体保留；
- 当前 new input 永远保留；
- 原始 `SQLiteSession.getItems()` 仍返回完整历史。

### 12.4 Identity

- 成功加载并 trim 外围空白；
- 缺失与空文件启动失败；
- Agent instructions 同时包含 core rules 和 Identity；
- Identity 不会进入 `AmadeusContext` dummy dependency。

### 12.5 应用生命周期

- Runner 与 Agent 每次启动只创建一次；
- `start()` 原样使用注入的 `Model`；
- Conversation 切换会等待旧 Turn settle；
- 切换后新 Turn 只写入新 Session；
- `close()` 等待正在进行的发声；
- 多次 `close()` 不重复关闭资源；
- close 后拒绝新 Turn；
- 启动中途失败会关闭已经打开的数据库，不处理调用者拥有的 Model/Provider。
- EOF、SIGINT 与 SIGTERM 收敛到同一条幂等关闭路径；
- 组合根先关闭 Application，再关闭 Provider。

## 13. 验收标准

- 重启后自动恢复最近 Conversation；
- 新建、恢复、重命名和归档不会混合或删除历史；
- SQLite 永久保留全部 Agent input/output/tool items；
- 模型只接收字符预算内的完整近期 Turn；
- Identity 稳定进入每轮 Agent instructions；
- Model、Runner 和 Agent 在应用生命周期内复用；
- Core 不读取模型服务配置，也不创建或关闭 Provider；
- Conversation 切换和 `close()` 等待当前 Turn 与 Utterance 清理；
- 完整历史可按 Conversation 查询，且查询不受模型上下文裁剪影响；
- `bun start` 提供正式文本调试入口并可靠关闭进程资源；
- OpenAI-compatible 模型真实双启动 smoke test 通过；
- `.env` 不进入日志、测试结果或 Git；
- core 中不存在 dummy Memory；
- 不增加第二套 Agent Framework。

## 14. 预计改动文件

```text
apps/amadeus/identity.md
apps/amadeus/scripts/smoke-llm.ts
apps/amadeus/src/main.ts
apps/amadeus/src/main.test.ts
apps/amadeus/src/application.ts
apps/amadeus/src/application.test.ts
apps/amadeus/src/agent.ts
apps/amadeus/src/agent.test.ts
apps/amadeus/src/amadeus.ts
apps/amadeus/src/runtime.test.ts
apps/amadeus/src/context.ts
apps/amadeus/src/identity.ts
apps/amadeus/src/identity.test.ts
apps/amadeus/src/conversation/conversation.ts
apps/amadeus/src/conversation/context-window.ts
apps/amadeus/src/conversation/context-window.test.ts
apps/amadeus/src/conversation/sqlite-conversations.ts
apps/amadeus/src/conversation/sqlite-conversations.test.ts
apps/amadeus/src/conversation/sqlite-session.ts
apps/amadeus/src/conversation/sqlite-session.test.ts
apps/amadeus/src/storage/sqlite.ts
apps/amadeus/src/storage/sqlite.test.ts
apps/amadeus/src/index.ts
docs/AMADEUS_DESIGN_ZH_ACTION_VOICE.md
```

删除：

```text
apps/amadeus/src/memory/memory.ts
```

## 15. 参考资料

以下资料来自官方 OpenAI documentation：

- [Agents SDK 总览](https://developers.openai.com/api/docs/guides/agents)
- [Running agents：Conversation strategy 与 Session](https://developers.openai.com/api/docs/guides/agents/running-agents)
- [Agent definitions：instructions 与 RunContext 边界](https://developers.openai.com/api/docs/guides/agents/define-agents)
- [Models and providers](https://developers.openai.com/api/docs/guides/agents/models)
- [Compaction](https://developers.openai.com/api/docs/guides/compaction)

采用的官方结论：

- 一个 SDK run 对应一个应用 Turn；
- 一个 Conversation 应选择一种延续策略，避免重复上下文；
- Session 适合需要自有持久化存储的对话；
- RunContext 是代码可见的本地依赖，不会自动成为模型上下文；
- 静态 instructions 是单 Agent 的首选起点；
- 长期交互需要压缩或裁剪上下文，但 compaction item 是不透明的 provider 能力。
