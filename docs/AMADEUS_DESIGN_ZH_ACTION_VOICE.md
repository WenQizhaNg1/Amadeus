# AMADEUS — 系统设计

> 一个随 USB 系统移动、以语音为第一交互方式、具有持续身份与记忆的个人 Agent。
>
> **设计原则：小核心，强边界，长连续性。**

本文档定义 AMADEUS v0.1 的架构基线。它不是功能清单，也不是未来能力的预埋清单；凡是当前没有明确需求的抽象，都不进入核心设计。

---

## 1. 设计目标

AMADEUS 不是「装在 U 盘里的聊天客户端」。

它是一套从便携 USB 存储设备启动的个人 Agent 系统：持久身份、会话与记忆随 USB 存在；当前计算机只是宿主（Host），提供 CPU、GPU、网络、麦克风、扬声器和显示设备。

v0.1 只追求以下体验：

- Linux 启动后直接进入 AMADEUS，不暴露传统桌面；
- 语音是第一交互通道，键盘文本仅作为调试与降级入口；
- Live2D 与终端风格界面共同构成她的可见存在；
- Agent 使用 OpenAI Agents SDK for TypeScript；
- STT/TTS 是可替换能力，可以连接本地或远程自训练模型；
- 会话与长期记忆落在本地 SQLite；
- 用户可以自然打断她；
- 她可以在合适的时机主动开口；
- 主要运行逻辑应当在少量源码文件中可读、可追踪。

核心原则：

> **不要围绕 Agents SDK 再造 Agent Framework。**
>
> AMADEUS 自己只负责 SDK 没有替我们解决、而又真正属于「她」的部分：Voice、Memory、Presence 与 Continuity。

### 1.1 明确不追求

v0.1 不追求：

- Multi-Agent hierarchy；
- 通用 Event Bus；
- Plugin Framework；
- Workflow DSL；
- Emotion Engine；
- Vector Database；
- 复杂 Relationship Graph；
- Autonomous Planning Loop；
- 多宿主同步；
- 完整离线推理路由；
- 任意 Avatar Scripting Language。

需要时再长出来，不为「以后也许有用」预先建层。

---

## 2. 外部设计参照

这套设计主要吸收三类成熟 Voice Agent 系统的经验，但不照搬它们的框架。

### 2.1 OpenAI Agents SDK

我们直接使用 SDK 已有原语：

- `Agent`
- `Runner`
- Tools
- `RunContext<T>`
- `Session`
- Streaming
- Guardrails / Handoffs（需要时）

`Runner` 已经负责模型—工具循环，并建议在应用生命周期内复用。`RunContext<T>` 就是应用依赖注入边界；`Session` 已经定义会话历史的持久化协议。

因此不再创建：

```text
AgentManager
ToolRegistry
WorkflowEngine
ConversationOrchestrator
```

流式 `run()` 支持 `AbortSignal`，可作为用户打断时取消模型生成的基础机制。

参考：

- https://openai.github.io/openai-agents-js/
- https://openai.github.io/openai-agents-js/guides/running-agents/
- https://openai.github.io/openai-agents-js/guides/sessions/
- https://openai.github.io/openai-agents-js/guides/streaming/

### 2.2 OpenAI Realtime Voice Agents

`RealtimeAgent` / `RealtimeSession` 最值得借鉴的不是具体模型，而是它的交互模型：

> Voice Agent 是一个持续存在的会话，而不是不断重复 `STT -> request -> TTS` 的无状态 RPC。

即使 AMADEUS 使用自定义 STT/TTS，也应该拥有明确的 turn detection、interruption 和持续会话语义。

参考：

- https://openai.github.io/openai-agents-js/guides/voice-agents/
- https://openai.github.io/openai-agents-js/guides/voice-agents/build/
- https://openai.github.io/openai-agents-js/guides/voice-agents/transport/

### 2.3 LiveKit Agents / Pipecat

LiveKit 的 `say()` / `SpeechHandle` 给了我们一个很好的分层：正常 Agent 回复自然进入 speech pipeline；显式 `say()` 用于启动问候、主动发言、工具执行过程中的短句等特殊行为，并且发声本身是可观察、可中断的对象。

LiveKit 还会在 interruption 后按实际播放进度修正会话历史。这说明「模型生成了什么」和「用户实际接收到什么」是两个不同状态。

Pipecat 则强化了另一个观点：用户开始说话、interruption、音频数据不是普通文本消息的附属品，而是实时交互的一等信号。

我们只借用这些领域语义，不引入它们完整的 pipeline/frame framework。

参考：

- https://docs.livekit.io/agents/logic/turns/
- https://docs.livekit.io/agents/multimodality/audio/
- https://docs.livekit.io/reference/agents-js/classes/agents.voice.SpeechHandle.html
- https://docs.pipecat.ai/pipecat/learn/pipeline

---

## 3. 领域词汇

命名要短，并且直接描述系统里真实存在的东西。

| 名称 | 含义 |
|---|---|
| `Amadeus` | 常驻运行的主体；负责把 Voice、Agent、Memory 与 Signal 组织成持续存在的行为 |
| `Agent` | OpenAI Agents SDK 中的认知主体 |
| `Session` | **仅指 OpenAI Agents SDK 的会话历史接口** |
| `Voice` | 听、说、turn-taking 与 interruption |
| `Turn` | 一次有边界的交互周期，可由用户发言或 Signal 发起 |
| `Utterance` | AMADEUS 一次真实发生、可中断、可追踪的发声行为；对应一次 `say` Action |
| `Signal` | 可以唤醒 AMADEUS 的外部变化或生命周期事件 |
| `Memory` | 跨会话保留的长期记忆 |
| `Stage` | AMADEUS 的可见、可听表现层；承载 Live2D、UI 与物理音频 I/O |
| `Cue` | Stage 的表现提示，例如表情、动作、视线 |

### 3.1 明确禁止的命名漂移

除非以后真的形成对应抽象，否则避免：

```text
AgentManager
VoiceController
MemoryEngine
RuntimeTrigger
ConversationOrchestrator
EventBus
```

尤其不要再定义第二个 `Session`。`Session` 这个名字已经属于 Agents SDK 的 conversation history boundary。

---

## 4. 系统形态

运行时只保留两个主要应用进程：

```text
                        Host devices
                 microphone / speaker / screen
                             │
                             ▼
                  ┌─────────────────────┐
                  │        Stage        │
                  │ Vue + Live2D/WebGL  │
                  │ AudioWorklet        │
                  └──────────┬──────────┘
                             │
                     local WebSocket
                    control + audio
                             │
                  ┌──────────▼──────────┐
                  │       Amadeus       │
                  │     Bun runtime     │
                  │                     │
                  │ Voice               │
                  │ Agent + Runner      │
                  │ Session             │
                  │ Memory              │
                  │ Tools               │
                  └─────────────────────┘
```

职责只有一句话：

> **Amadeus 决定发生什么；Stage 负责让它发生在屏幕、麦克风和扬声器上。**

### 4.1 Amadeus 负责

- turn detection / endpointing；
- STT / TTS 调度；
- Agent run；
- 工具调用；
- interruption 语义；
- Session history；
- 长期 Memory；
- Signal 驱动的主动行为；
- 当前 Activity；
- 向 Stage 发出 Cue。

### 4.2 Stage 负责

- 获取麦克风音频；
- 播放输出音频；
- Live2D 渲染；
- TUI 风格界面；
- 字幕 / transcript 展示；
- 本地 lip sync；
- 把 Audio 与用户输入发送给 Amadeus。

Stage 不知道 OpenAI、SQLite、Tools 或 Agent Loop。

---

## 5. Amadeus 必须保持薄

顶层 runtime 不需要成为新的框架。

```ts
import { Agent, Runner } from '@openai/agents';

export const agent = new Agent<AmadeusContext>({
  name: 'AMADEUS',
  instructions,
  tools,
});

export const runner = new Runner();
```

应用依赖直接通过 SDK Context 注入：

```ts
export interface AmadeusContext {
  voice: Voice;
  memory: Memory;
}
```

一次普通交互的核心仍然只是：

```ts
const result = await runner.run(agent, input, {
  context,
  session,
  stream: true,
  signal,
});
```

复杂性应该发生在真实领域问题里，而不是发生在 `Runner` 外面的包装层里。

---

## 6. Voice 是 Runtime 的一等能力

Voice 不是 Stage 的附属，也不是 `LLM -> TTS` 的后处理器。

它负责：

- VAD / turn detection / endpointing；
- STT；
- TTS；
- 流式文本分段；
- speech queue；
- interruption；
- Utterance 生命周期；
- 播放进度与 conversation history 的协调。

它不直接拥有麦克风和扬声器设备。设备属于 Stage，Voice 看到的是音频流。

### 6.1 Audio

```ts
export interface AudioFrame {
  data: Float32Array;
  sampleRate: number;
  channels: number;
}
```

WebSocket 上不必把 `AudioFrame` 序列化成 JSON。Stage 与 Amadeus 在流开始时约定格式，音频本体使用 binary frame 传输。

### 6.2 STT

```ts
export type Transcript =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string };

export interface Transcriber {
  transcribe(
    audio: AsyncIterable<AudioFrame>,
    signal?: AbortSignal,
  ): AsyncIterable<Transcript>;
}
```

Whisper、SenseVoice、自训练 ASR、远程 API 都只是不同的 `Transcriber`。

### 6.3 TTS

TTS 的边界应当非常窄：

> **Agent 决定“说什么、一次说多少”；Synthesizer 只负责把一次已经决定好的发声文本变成音频。**

```ts
export interface SpeechStyle {
  voice?: string;
  emotion?: string;
  speed?: number;
}

export interface Synthesizer {
  synthesize(
    text: string,
    options?: SpeechStyle,
    signal?: AbortSignal,
  ): AsyncIterable<AudioFrame>;
}
```

Whisper、SenseVoice、自训练 ASR、角色 TTS 都只是可替换实现。

Voice **不做语义断句**，也不把一段 Agent 文本重新解释成多次发声。一次 `say()` 调用就是一次明确的语言行为。

底层为了流式传输而进行的 PCM chunking 只是传输细节，不进入领域模型。

## 7. Turn 与 Utterance

只保留两个真正有语义价值的概念。

### 7.1 Turn

`Turn` 是一次有边界的认知/行为周期。

它可以由用户语音开启：

```text
user speech
  ↓
STT final
  ↓
Agent run
  ↓
actions
  ↓
turn complete
```

也可以由 `Signal` 开启：

```text
startup / idle / timer
  ↓
Amadeus.wake(signal)
  ↓
Agent run
```

一个 Turn 内，Agent 可以执行零个、一个或多个 Action。

### 7.2 Utterance

`Utterance` 是 AMADEUS 一次真实发生的发声行为。

**一次 `say()` Tool Call 对应一个 Utterance。**

```ts
export type UtteranceResult =
  | { status: 'finished' }
  | { status: 'interrupted' };

export interface Utterance {
  readonly id: string;

  interrupt(): void;

  readonly done: Promise<UtteranceResult>;
}
```

不再试图在 Runtime 中维护一个“实际听到了哪些字符”的伪精确字段。

如果一次发声被打断，事实本身已经足够明确：

```text
say("这个问题其实可以分成三个部分……")
→ interrupted
```

Agent 的历史应该保留：

1. 她曾决定执行这次 `say`；
2. 这次发声没有完成。

如果未来 TTS 能稳定提供 word-level timing，再把精确播放位置作为可选观测数据加入，而不是让 v0.1 的核心依赖它。

### 7.3 Voice

```ts
export interface SayOptions {
  style?: SpeechStyle;
  interruptible?: boolean;
}

export interface Voice {
  say(
    text: string,
    options?: SayOptions,
  ): Utterance;

  interrupt(): void;
}
```

`Voice` 的职责是执行发声，而不是替 Agent 创作发声结构：

```text
Agent
  ↓
say("嗯……")
  ↓
Voice
  ↓
Synthesizer
  ↓
Stage playback
```

**语言节奏属于 Amadeus，音频执行属于 Voice。**

## 8. Activity 不属于 Voice

`thinking` 不是一种 Voice 状态。

因此不要写：

```text
Voice.state = listening | thinking | speaking
```

而把全局表现状态放在 Amadeus 上：

```ts
export type Activity =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking';
```

Stage 只需要订阅 `activity`，再把它映射成 Live2D 行为。

这避免 Voice 为了 UI 动画而承担并不属于语音层的「思考」语义。

---

## 9. 说话就是 Action

这是 Voice 设计的核心规则：

> **AMADEUS 不存在“普通文本回复自动转 TTS”这条旁路。所有真正对用户说出口的话，都必须由 Agent 显式执行 `say`。**

因此不再有：

```text
Agent raw text
  ↓
Voice 自动断句
  ↓
TTS
```

而是：

```text
Agent decides
  ↓
say(...)
  ↓
Voice
  ↓
TTS
  ↓
Stage
```

### 9.1 `say` Tool

```ts
export const say = tool({
  name: 'say',

  description: `
Speak aloud to the user.
Calling this tool is the only way to produce user-facing speech.
Choose the wording, length, tone, and number of utterances yourself.
`,

  parameters: z.object({
    text: z.string().min(1),

    emotion: z.string().optional(),

    speed: z.number().optional(),

    interruptible: z.boolean().default(true),
  }),

  async execute(args, ctx) {
    const utterance = ctx.context.voice.say(args.text, {
      style: {
        emotion: args.emotion,
        speed: args.speed,
      },
      interruptible: args.interruptible,
    });

    return await utterance.done;
  },
});
```

在 v0.1 中，`say` 默认等待这次 Utterance 完成或被打断后再把 Tool Result 返回给 Agent。

这让 Tool 的语义非常诚实：

```text
Agent: 我决定说这句话
  ↓
say(...)
  ↓
现实中实际执行
  ↓
finished / interrupted
  ↓
Agent 再决定下一步
```

### 9.2 Agent 的最终文本不是用户界面

`Runner` 的 final output 不直接显示，也不自动送 TTS。

用户可感知的语言只有 `say()`。

为了减少模型偶然把最终文本当作回答，可以把最终输出约束成一个极小的结构，例如：

```ts
const TurnResult = z.object({
  done: z.literal(true),
});
```

```ts
const agent = new Agent<Context, typeof TurnResult>({
  // ...
  outputType: TurnResult,
});
```

也就是说：

```text
Tool Calls = 行为
Final Output = 本轮执行结束的机器状态
```

这让 AMADEUS 从“文本生成器 + 语音后处理”变成真正的 Action-oriented Agent。

## 10. AMADEUS 自己决定怎么说

Voice 不应该替 AMADEUS 决定一句话在哪里断开。

例如她想表达：

> 嗯……我大概明白了。不过这里还有一个问题。

有几种完全不同的行为选择。

### 一次说完

```text
say("嗯……我大概明白了。不过这里还有一个问题。")
```

这是一个 Utterance。

### 分两次说

```text
say("嗯……我大概明白了。")
say("不过这里还有一个问题。")
```

这是两个 Utterance。

### 干脆不说

对于某些 Signal 或内部动作：

```text
(no say call)
```

沉默也是 Agent 的合法选择。

因此“说几句话”“在哪里停顿”“什么时候插一句”“工具前还是工具后开口”都属于 **Agent policy**，而不是 Voice 的 text segmentation policy。

这会牺牲一点纯粹追求最低延迟时的效率：每次 `say` 结束后，Agent 可能需要重新进入一次模型决策。但这是我们主动选择的交换——把节奏和人格表现交给 Amadeus，而不是交给一个标点切分器。

v0.1 建议：

```ts
modelSettings: {
  parallelToolCalls: false,
}
```

这样 Action 保持严格因果顺序：

```text
say → tool → say → say
```

不会出现两个 `say` 并行执行、声音重叠之类难以解释的状态。

如果未来性能测试证明模型往返成为明显瓶颈，再针对性加入“批量 Action”或异步 Utterance，而不是一开始就牺牲语义清晰度。

## 11. Interruption 是正常控制流

用户打断不是 Error Case，而是一次 `say` Action 的正常结果。

```text
Agent calls say(...)
      ↓
Utterance is playing
      │
      │ user starts speaking
      ▼
turn detector
      │
      ├─ interrupt current Utterance
      ├─ cancel synthesis / playback
      └─ resolve say(...) as interrupted
```

因此 `say` 的 Tool Result 应该非常简单：

```ts
type SayResult =
  | { status: 'finished' }
  | { status: 'interrupted' };
```

这比事后修改 assistant 文本历史更自然。

Session 中保存的事实是：

```text
Agent chose:
say("这个问题其实可以分成三个部分……")

Result:
interrupted
```

而不是伪造一条：

```text
assistant:
"这个问题其实……"
```

因为系统在没有 word-level timing 时并不知道精确说到了哪个字符；而且对下一轮推理来说，“她想说什么，但被打断了”本身就是更完整的语义。

### 11.1 打断之后怎么进入下一轮

v0.1 采用最简单的策略：

```text
user starts speaking
  ↓
interrupt current Utterance
  ↓
cancel current user-facing Turn
  ↓
start STT for the new user Turn
```

当前 `Runner` 是否立即 abort，属于 Runtime 实现策略。

原则是：

- 用户可感知的发声必须立即停止；
- 不让旧 Turn 在后台继续产生新的 `say`；
- 已经发生且不可逆的 Tool side effect 不假装回滚；
- 新用户输入拥有更高优先级。

如果以后发现需要更复杂的“打断后继续原任务”语义，再增加恢复机制；v0.1 不提前设计。

## 12. 主动行为：Signal 唤醒，而不是后台 Agent Loop

Agent 不运行时不会凭空产生 tool call。

因此主动行为需要一个明确入口：`Signal`。

```ts
export type Signal =
  | { type: 'startup' }
  | { type: 'idle'; forMs: number }
  | { type: 'network.changed'; online: boolean }
  | { type: 'timer'; name: string };
```

Signal 不等于 Event Bus，也不要求通用 Scheduler。

它只是告诉顶层 `Amadeus`：世界里发生了一件也许值得注意的事。

```ts
export class Amadeus {
  async turn(text: string): Promise<void> {
    // user-initiated turn
  }

  async wake(signal: Signal): Promise<void> {
    // decide whether the signal deserves an agent run
  }

  interrupt(): void {
    // interrupt current interaction according to policy
  }
}
```

注意这里不再定义第二个 `Session.wake()`。

`Session` 只属于 Agents SDK；生命周期行为属于 `Amadeus`。

### 12.1 沉默必须是一等结果

主动行为最重要的不是「什么时候说话」，而是「大多数时候应该不说话」。

> **沉默是合法结果。**

v0.1 不做持续 autonomous thinking loop，只响应少量明确 Signal。

---

## 13. Session 与 Memory

两个概念必须完全分开。

### 13.1 Session：对话连续性

这里的 `Session` **只指 OpenAI Agents SDK 的 `Session` interface**。

SQLite 实现负责：

- `getSessionId()`
- `getItems()`
- `addItems()`
- `popItem()`
- `clearSession()`

SDK 在 run 前读取历史，在 run 后保存新的 conversation items。

对于 AMADEUS，Session 是模型维持近期对话连续性的工作历史，而不是长期人格记忆。

### 13.2 Memory：长期连续性

长期记忆保持一个非常小的接口：

```ts
export interface MemoryItem {
  id: string;
  text: string;
  kind: 'fact' | 'episode' | 'relationship';
  importance: number;
  createdAt: number;
}

export interface Memory {
  recall(query: string, limit?: number): Promise<MemoryItem[]>;

  remember(
    item: Omit<MemoryItem, 'id' | 'createdAt'>,
  ): Promise<MemoryItem>;

  forget(id: string): Promise<void>;
}
```

v0.1：

```text
SQLite
├─ conversation_items
├─ memories
└─ FTS5
```

以后加入 Embedding、reranking 或 compaction 时，不修改 `Memory` 的外部边界。

对于单用户 USB Agent，不引入 Qdrant、Redis、PostgreSQL、Chroma 或 Milvus。

### 13.3 SQLite 是唯一持久化基础设施

建议：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

数据文件：

```text
/data/amadeus.db
```

Identity、Session、Memory 与少量运行元数据都可以落在同一个数据库里；逻辑边界靠表与代码，而不是靠多个数据库服务表达。

---

## 14. Stage：她出现的地方

`Stage` 不是普通 Web Frontend。

它是 AMADEUS 的表现面：

```text
terminal-like UI
+ Live2D
+ microphone
+ speaker
+ transcript
```

技术栈：

```text
Vue 3
Vite
TypeScript
Cubism SDK for Web
Web Audio / AudioWorklet
WebSocket
Chromium kiosk
Cage / Wayland
```

### 14.1 Live2D

Stage 只接收高层 Cue：

```ts
export interface Cue {
  emotion?: string;
  motion?: string;
  gaze?: 'user' | 'away' | 'screen';
}
```

不要在拿到真实模型、确认参数和动作命名之前设计庞大的 Avatar Protocol。

Lip sync 直接根据正在播放的音频在 Stage 本地驱动，避免把高频嘴型参数通过 WebSocket 往返。

### 14.2 Activity

Stage 订阅：

```ts
export type Activity =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking';
```

它负责把 Activity 映射为：

- Live2D idle motion；
- listening gaze；
- thinking posture；
- speaking lip sync / expression；
- TUI 状态指示。

映射规则属于 Stage，不属于 Agent prompt。

---

## 15. Stage Link

本机 Stage 与 Amadeus 之间只保留一条 WebSocket。

```text
JSON          control / state / transcript / cue
Binary Frame  audio
```

概念消息：

```text
Stage -> Amadeus

stage.ready
mic.start
mic.audio          (binary)
mic.stop
input.text         (debug/fallback)
user.interrupt

Amadeus -> Stage

activity
transcript.partial
transcript.final
utterance.start
utterance.end
cue
speaker.start
speaker.audio      (binary)
speaker.stop
error

Stage -> Amadeus（播放确认）

speaker.played
```

### 15.1 音频流必须有边界

不要仅靠「收到 binary frame 就猜它是什么」。

`speaker.start` / `mic.start` 应至少携带：

```ts
export interface AudioFormat {
  streamId: string;
  sampleRate: number;
  channels: number;
  encoding: 'f32le' | 's16le';
}
```

后续 binary frame 属于当前 stream；`*.stop` 表示 Runtime 已经发送完该音频流。

Stage 必须在音频**真正完成 playout** 后回报：

```text
speaker.played(streamId)
```

只有收到这个确认，当前 `Utterance.done` 才解析为：

```ts
{ status: 'finished' }
```

如果用户在此前打断：

```ts
{ status: 'interrupted' }
```

因此 playback acknowledgement 的作用不是计算“听到了哪些字”，而是给 `say` Action 一个可靠的完成边界。

v0.1 不支持并发 speaker stream；同一时刻最多只有一个用户可感知的 Utterance。这样可以显著简化 interruption 和顺序语义。

---

## 16. Tools：保持普通，但权限必须明确

Tools 继续使用 Agents SDK function tools。

```text
Agent
  ↓
SDK Tool
  ↓
AmadeusContext
  ↓
Memory / Voice
```

不要再加 `ToolRegistry`。

但宿主机工具必须遵守最小权限：

- 读系统信息可以默认允许；
- AMADEUS 自己的数据目录可以正常读写；
- 宿主文件写入、shell、设备操作属于高权限行为；
- 破坏性或不可逆操作必须经过明确授权。

这不是新的权限框架需求。v0.1 可以从几个简单的 allow/confirm 规则开始。

---

## 17. 源码结构

第一版不做 package ceremony。

```text
amadeus/
├─ apps/
│  ├─ amadeus/
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ amadeus.ts
│  │     ├─ agent.ts
│  │     ├─ activity.ts
│  │     ├─ context.ts
│  │     ├─ signal.ts
│  │     │
│  │     ├─ conversation/
│  │     │  └─ sqlite-session.ts
│  │     │
│  │     ├─ storage/
│  │     │  └─ sqlite.ts
│  │     │
│  │     ├─ voice/
│  │     │  ├─ voice.ts
│  │     │  ├─ utterance.ts
│  │     │  ├─ audio.ts
│  │     │  ├─ audio-encoding.ts
│  │     │  ├─ transcriber.ts
│  │     │  └─ synthesizer.ts
│  │     │
│  │     ├─ memory/
│  │     │  └─ memory.ts
│  │     │
│  │     ├─ tools/
│  │     │  └─ say.ts
│  │     │
│  │     └─ integrations/
│  │        └─ stage/
│  │           ├─ protocol.ts
│  │           └─ cue.ts
│  │
│  └─ stage/
│     └─ src/
│        ├─ App.vue
│        ├─ live2d/
│        ├─ audio/
│        └─ link.ts
│
├─ data/
│  └─ amadeus.db
│
└─ package.json
```

如果 `link` 类型真的需要两边共享，再提取到：

```text
packages/protocol
```

在那之前，不抽 package。

---

## 18. v0.1 依赖

### Amadeus

```text
bun
@openai/agents
zod
bun:sqlite
```

VAD / turn detector 等到实际 STT 接入方案确定后再选。`Voice` 不绑定某个 detector。

### Stage

```text
vue
vite
@vitejs/plugin-vue
typescript
Cubism SDK for Web
```

明确不引入：

```text
Electron
Tauri
Hono / Express    # 除非真的出现 HTTP routing 需求
Message Broker
External Database
```

系统层：

```text
Debian minimal
systemd
Cage
Wayland
Chromium kiosk
```

---

## 19. 四条关键交互路径

### A. 正常对话

```text
user speaks
  ↓
Stage captures PCM
  ↓
Voice detects turn
  ↓
STT final
  ↓
Runner.run(...)
  ↓
Agent chooses say(...)
  ↓
Voice / TTS
  ↓
Stage playback
  ↓
say result: finished
  ↓
Agent may choose another Action or finish Turn
```

### B. 用户打断

```text
AMADEUS speaking
  ↓
user speech detected
  ↓
Utterance.interrupt()
  ↓
cancel synthesis / playback
  ↓
say result: interrupted
  ↓
current Turn ends / is cancelled
  ↓
new user Turn
```

具体由 Runtime 决定何时 abort 当前 Agent run；关键事实是 interruption 属于 `say` Action 的正常结果，而不是异常。

### C. 主动开口

```text
startup / idle / timer signal
  ↓
Amadeus.wake(signal)
  ↓
Agent run
  ↓
zero or more Actions
       ├─ say(...)
       ├─ tool(...)
       └─ ...
  ↓
finish Turn
```

如果 Agent 没有调用 `say`，那么她就保持沉默。

## 20. v0.1 验收标准

第一版真正成立，只需要这些事情全部连起来：

1. USB Linux 启动后自动进入 Stage；
2. 麦克风语音能稳定形成用户 Turn；
3. STT 可以替换为自训练服务；
4. Agents SDK 能完成 Tool-driven Agent Loop；
5. `say` 是唯一用户可感知的语言输出路径；
6. Agent 可以在一个 Turn 中自主选择调用 `say` 零次、一次或多次；
7. TTS 可以替换为角色自训练服务；
8. 用户开口能打断当前 Utterance；
9. `say` 能向 Agent 返回 `finished / interrupted`；
10. Stage 能根据 Activity / Cue 驱动 Live2D；
11. 重启后 Session 与 Memory 仍然存在；
12. startup / idle Signal 可以触发一次克制的主动行为；
13. 整个核心不依赖第二套 Agent Framework，也不依赖 Runtime 文本断句策略。

达到这些，AMADEUS v0.1 就成立了。

## 21. 最终概念模型

输入与输出不是同一条流水线：

```text
                    ┌───────────────┐
                    │     Stage     │
                    │ Live2D / I/O  │
                    └───────┬───────┘
                            │ PCM
                            ▼
                          Voice
                            │ STT / Turn
                            ▼
                    ┌───────────────┐
          Signal ──►│    Amadeus    │
                    │ Agent + Runner│
                    └───┬───────┬───┘
                        │       │
                     Actions  Session
                        │
                     say(...)
                        │
                        ▼
                      Voice
                        │
                        │ TTS / audio
                        ▼
                      Stage

Memory ───────────────► Agent Context
```

核心语义可以压缩成一句：

> **Voice 把用户的话交给 Amadeus；Amadeus 通过 `say` 把自己的话交给 Voice。**

真正重要的，是图里没有什么：

- Agents SDK 外没有第二套 orchestration framework；
- 为了接 STT/TTS 没有引入额外 Voice Framework；
- 单用户便携 Agent 没有部署基础设施集群；
- Stage 不参与认知；
- Voice 不决定措辞、断句或说几次；
- Agent raw text 不会自动变成用户可感知的语音；
- Session 不承担长期人格记忆。

复杂度应该投入在：

```text
Personality
Memory
Voice
Turn-taking
Live2D Presence
Proactive Behavior
Continuity
```

而不是 Backend Architecture。

> **AMADEUS 应该因为行为连贯、人格持续而显得复杂，而不是因为后端本身复杂。**
