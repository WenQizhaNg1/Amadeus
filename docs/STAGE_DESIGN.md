# AMADEUS Stage 方案

> 状态：已批准，2026-09-04。
>
> 本文定义 Stage 第一阶段的技术基线、代码边界和通信协议。具体视觉稿、TTS、STT、
> VAD 服务与 Live2D 模型不在本次决策范围内。

## 1. 目标

Stage 是 AMADEUS 的本地交互与呈现应用，负责：

- Live2D 渲染、动作、表情、视线与 lip sync；
- 字幕、输入、连接状态和运行状态 UI；
- 麦克风采集、扬声器播放与用户打断；
- 通过本机连接与 AMADEUS Core 交换控制消息和 PCM 音频；
- 在 Linux Chromium kiosk 环境中全屏运行。

第一阶段优先建立一条可验证的交互链路：

```text
用户文本 -> Stage -> Core -> Activity / Utterance -> Stage UI
```

Stage 保持为 Core 的外部适配器。Core 可以继续脱离浏览器和 Live2D 独立测试。

## 2. 技术基线

| 领域 | 选择 | 说明 |
| --- | --- | --- |
| UI | React 19 + TypeScript | 管理界面组合和低频 UI 状态 |
| UI 基础 | shadcn/ui | 组件源码进入仓库，按需添加 |
| 样式 | Tailwind CSS v4 | 使用 CSS-first 配置和设计变量 |
| 构建 | Vite | 开发服务器、HMR、资源处理与生产构建 |
| 包管理与脚本 | Bun | 安装、脚本、类型检查和测试统一由 Bun 执行 |
| 控制连接 | 原生 WebSocket | JSON 控制消息和 binary PCM 共用一条本机连接 |
| 协议校验 | Zod | schema 是消息类型的唯一事实来源 |
| 音频 | Web Audio API + AudioWorklet | 低延迟播放、采集和播放完成确认 |
| Live2D | 官方 Cubism SDK for Web | 通过项目内的薄适配层接入 |
| 部署外壳 | Chromium kiosk | 固定 Linux 环境下运行 Stage |

第一版不引入 React Router、Redux、Zustand、TanStack Query、Socket.IO、Electron、
Tauri 和通用事件总线。出现真实需求后再评估。

### 2.1 shadcn/ui 使用约束

shadcn/ui 是进入仓库的组件源码，项目拥有这些代码并负责维护。初始约定如下：

- 使用 `new-york` 风格、Tailwind CSS v4 和 CSS variables；
- 主题变量采用当前 shadcn/ui 默认的 OKLCH 表达；
- 只添加实际使用的组件，不执行全量安装；
- 通用 shadcn 组件放在 `src/ui/components/`；
- AMADEUS 特有界面通过组合通用组件实现；
- 应用特有样式不持续堆入通用组件；
- `components.json` 将 `ui` 指向 `@/ui/components`，将 `utils` 指向
  `@/ui/lib/cn`；
- 全局样式和主题放在 `src/ui/styles/globals.css`。

当前只有 Stage 使用 UI，因此不建立 `packages/ui`。如果未来出现设置器、管理端等第二个
前端，并且确实复用同一批组件，再提取共享 UI package。

## 3. 运行时边界

React 负责 DOM 和低频状态。音频与 Live2D 的实时循环由各自模块持有，避免音频帧、
RMS 或逐帧模型参数触发 React render。

```text
                     ┌──────────────────────┐
WebSocket ──────────>│ Stage application    │────> React UI
                     │ state + coordination │
                     └──────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              Audio engine           Cubism stage
                    │                       ▲
                    └── analyser / RMS ─────┘
```

边界规则：

- `application/` 组合连接、音频、Live2D 和 UI 状态；
- `transport/` 只处理连接、重连、消息收发和协议解析；
- `audio/` 只处理浏览器音频设备、PCM 队列和播放状态；
- `live2d/` 只处理 Cubism 生命周期和表现映射；
- `ui/` 不直接解析 WebSocket 消息，也不直接管理 AudioContext；
- 高频数据在音频和 Live2D 模块之间传递；
- 不增加依赖注入容器或内部消息总线。

## 4. 仓库结构

建议在本阶段把仓库明确为 Bun workspace。根 `package.json` 负责公共脚本，各 workspace
声明自己的运行依赖。

```text
apps/
├── amadeus/
│   ├── package.json
│   └── src/
│       ├── main.ts
│       └── ...
└── stage/
    ├── package.json
    ├── components.json
    ├── index.html
    ├── vite.config.ts
    ├── public/
    └── src/
        ├── main.tsx
        ├── application/
        ├── audio/
        ├── live2d/
        ├── transport/
        └── ui/
            ├── components/
            ├── interaction/
            ├── layout/
            ├── lib/
            └── styles/

packages/
└── stage-protocol/
    ├── package.json
    ├── src/
    │   ├── main.ts
    │   ├── audio/
    │   ├── message/
    │   └── version/
    └── tests/

data/
└── stage/
    └── models/
```

`apps/amadeus/src/` 和 `apps/stage/src/` 根目录分别只保留 `main.ts` 与 `main.tsx`。

Live2D 模型是运行数据，默认位于 `data/stage/models/`，由 Bun Core 提供只读静态访问。
Cubism Core 和 Framework 属于 SDK 代码，单独放在 Stage 的 vendor 边界或按官方许可
允许的方式引入。两类资源不混放。

## 5. `stage-protocol` package

### 5.1 所有权

`@amadeus/stage-protocol` 只描述线上格式，不包含 WebSocket、React、Bun server、
Agent SDK 或业务实现。

```text
                 zod
                  │
                  ▼
       @amadeus/stage-protocol
              ▲          ▲
              │          │
      apps/amadeus    apps/stage
```

依赖规则：

- protocol package 只依赖 Zod；
- Stage 和 Core 都依赖 protocol package；
- protocol package 不导入任何 app 源码；
- Core 领域类型与 wire DTO 分开；
- `StageLink` 是 Core 侧端口，继续留在 `apps/amadeus`；
- package 直接导出 TypeScript 源码，由 Bun 和 Vite 消费，不单独产生构建产物；
- `src/main.ts` 是唯一公开入口。

### 5.2 Schema 与类型

每类消息同时定义 schema 和推导类型：

```ts
export const stageToAmadeusMessageSchema = z.discriminatedUnion('type', [
  // message schemas
]);

export type StageToAmadeusMessage = z.infer<
  typeof stageToAmadeusMessageSchema
>;
```

不再手写一份容易漂移的平行 interface。传输层先执行 `JSON.parse`，随后调用对应 schema
的 `safeParse`。校验失败时记录 Zod issue，并向对端发送稳定错误码。

兼容规则：

- `PROTOCOL_VERSION` 是整数主版本，初始值为 `1`；
- 破坏性字段或语义变化提升版本；
- 增加可选字段不提升版本；
- 接收端允许已知消息出现未知附加字段；
- 未知 `type`、错误字段类型和非法状态转换都视为协议错误；
- v1 阶段只接受相同主版本，不维护多版本适配器。

### 5.3 消息目录

Stage 到 Core：

| `type` | 关键字段 | 语义 |
| --- | --- | --- |
| `stage.ready` | `protocolVersion` | Stage 已完成基础初始化，可以接收状态和播放命令 |
| `input.text` | `requestId`, `text` | 提交一个用户文本输入 |
| `user.interrupt` | 无 | 请求停止当前发声与 Agent run |
| `mic.start` | `format` | 开始一个麦克风 PCM 流 |
| `mic.stop` | `streamId` | 结束麦克风流 |
| `speaker.played` | `streamId` | 已完整播放指定扬声器流 |

Core 到 Stage：

| `type` | 关键字段 | 语义 |
| --- | --- | --- |
| `stage.state` | `protocolVersion`, `activity` | 首次连接或重连后的状态快照 |
| `input.accepted` | `requestId` | 输入已经通过边界校验并交给 Runtime |
| `activity` | `activity` | 当前 `idle/listening/thinking/speaking` 状态 |
| `transcript.partial` | `streamId`, `text` | 当前麦克风流的临时识别结果 |
| `transcript.final` | `streamId`, `text` | 当前麦克风流的最终识别结果 |
| `utterance.start` | `utteranceId`, `text` | 开始一次可见发声并展示字幕 |
| `utterance.end` | `utteranceId`, `status` | 发声完成、中断或失败 |
| `cue` | `cue` | 情绪、动作和视线提示 |
| `speaker.start` | `utteranceId`, `format` | 后续 binary frame 属于该扬声器流 |
| `speaker.stop` | `streamId`, `reason` | 扬声器流已没有更多输入帧 |
| `error` | `code`, `message`, `recoverable`, `requestId?` | 可显示和可分类的协议错误 |

与当前协议相比，v1 提案增加：

- 协议版本和连接状态快照；
- `requestId` 与 `input.accepted`；
- `utterance.start.text`，供 Stage 显示准确字幕；
- transcript 的 `streamId`；
- 稳定的错误 `code` 和可选请求关联。

`requestId` 用于关联 UI、确认与错误。`input.accepted` 只表示输入已经交给 Runtime，
不表示 Agent run 已经完成。该 ID 不自动提供幂等语义。连接中断后 Stage 不自动重发
用户输入，避免产生重复 Turn。

### 5.4 音频格式

控制消息使用 JSON，PCM 使用 WebSocket binary frame。`AudioFormat` 包含：

- `streamId`；
- `sampleRate`；
- `channels`；
- `encoding: 'f32le' | 's16le'`。

v1 不给每个 binary frame 增加自定义包头。WebSocket 保证消息顺序和 frame 边界，协议
明确以下约束：

- 每个方向同时最多存在一个活动音频流；
- `speaker.start` 后、对应 `speaker.stop` 前的 binary frame 属于该 speaker stream；
- `mic.start` 后、对应 `mic.stop` 前的 binary frame 属于该 microphone stream；
- 没有活动流时收到 binary frame 属于协议错误；
- 新流开始前必须结束旧流；
- 多路并行音频成为真实需求时再设计带 stream identifier 的 v2 binary header。

这组规则将在两端的接收状态机和 transport 测试中落实。

## 6. 连接与状态管理

Stage 连接状态：

```text
disconnected -> connecting -> awaiting-state -> ready
      ▲                                      │
      └──────────── reconnecting <───────────┘
```

约定：

- WebSocket 打开后发送 `stage.ready`；
- 收到合法 `stage.state` 后进入 `ready`；
- 使用有限指数退避和 jitter 自动重连；
- 主动关闭不触发重连；
- 断开时立即停止麦克风、清空播放队列并释放当前流状态；
- Core 收到断开事件后调用现有的 `stageDisconnected` 路径；
- 重连成功后 Core 发送当前 Activity，不恢复已经中断的音频流；
- Stage 不缓存并重放用户命令。

扬声器播放状态：

```text
idle -> buffering -> playing -> draining -> idle
                    │            │
                    └-> stopped <-┘
```

`speaker.stop(reason: 'completed')` 表示输入结束。Stage 必须等待 AudioWorklet 队列真正
清空后发送 `speaker.played`。`interrupted` 和 `failed` 会立即清空队列，不发送播放完成
确认。

## 7. Stage UI 状态

第一版使用一个明确的 reducer 管理可呈现状态：

- connection status；
- AMADEUS Activity；
- 当前 partial/final transcript；
- 当前 utterance 与字幕；
- microphone 状态；
- 可恢复和不可恢复错误。

WebSocket、AudioContext、AudioWorkletNode 和 Cubism renderer 是带生命周期的资源，
由专用模块持有。reducer 只保存可序列化状态和稳定 ID。

首批 shadcn/ui 组件按实际界面需要添加，预计包含 `Button`、`Input`、`Badge`、`Alert`
和 `Tooltip`。设置面板出现后再考虑 `Sheet`、`Select` 和 `Slider`。

初始布局：

```text
┌──────────────────────────────────────────────┐
│ connection / activity                       │
│                                              │
│                Live2D canvas                 │
│                                              │
│                   subtitle                   │
│ transcript                         interrupt │
│ [ text input                             ][>]│
└──────────────────────────────────────────────┘
```

首次启动显示明确的“开始交互”操作，用于恢复 `AudioContext` 和申请麦克风权限。kiosk
环境可以配置 Chromium autoplay policy，但 UI 仍保留可恢复入口。

## 8. 开发与生产拓扑

开发：

```text
Chromium -> Vite dev server -> /ws proxy -> Bun Core
```

- Vite 负责 React HMR、Tailwind 和 Stage 静态资源；
- `/ws` 通过 Vite 代理到 Core，浏览器始终使用同源地址；
- Core 和 Stage 可以独立启动；
- localhost 满足浏览器 secure context 要求。

生产：

```text
Chromium kiosk -> Bun Core
                  ├── Stage dist
                  ├── /ws
                  └── model resources
```

Vite 不进入生产运行时。Bun 提供构建后的静态文件、WebSocket 与模型资源，Chromium
访问本机地址。

## 9. 测试策略

所有自动化命令继续使用 Bun。

### Protocol

- 每种合法消息的解析；
- 缺失字段、错误字段和未知 `type`；
- 协议版本不匹配；
- ID、空文本、采样率和声道边界；
- JSON round trip。

### Core transport

- 连接、断开与重连；
- 非法消息返回稳定错误；
- 输入只提交一次；
- Activity 初始快照；
- WebSocket backpressure；
- binary frame 状态转换；
- 断开时结束活动 Utterance。

### Stage

- reducer 状态转换；
- socket 重连且不重放命令；
- binary frame 状态转换；
- speaker 完整播放、打断与清空；
- `speaker.played` 只在队列清空后产生；
- React 组件的关键交互。

Web Audio、麦克风权限和 WebGL 行为最终需要真实 Chromium 验证。等基础交互稳定后再
引入 Playwright，不用 DOM 模拟器替代这些浏览器能力。

## 10. 实施切片

### 切片一：workspace 与协议

- 建立 Bun workspace 边界；
- 创建 `@amadeus/stage-protocol`；
- 将现有 wire 类型迁移为 Zod schema；
- 将 `StageLink` 留在 Core 适配层；
- 增加协议单元测试；
- 保持现有 Core 行为通过测试。

### 切片二：Stage UI 骨架

- 创建 React、Vite、Tailwind CSS v4 和 shadcn/ui 基线；
- 建立目录与主题变量；
- 实现启动界面、连接状态、Activity、字幕和文本输入；
- 使用模拟 transport 独立开发 UI。

### 切片三：本机连接

- 实现 Bun WebSocket adapter；
- 实现 Stage socket、解析与重连；
- 打通文本输入、Activity、字幕和打断；
- 验证协议错误与断开恢复。

### 切片四：扬声器输出

- 接入 AudioWorklet PCM 队列；
- 打通 `speaker.start/stop/played`；
- 验证打断和断开；
- 从真实播放信号计算 lip sync 输入。

### 切片五：Live2D

- 接入官方 Cubism SDK；
- 加载 `data/stage/models/` 中的模型；
- 实现 Activity、Cue、视线和 lip sync 映射；
- 审核 SDK 与模型许可。

### 切片六：麦克风输入

- 接入 `getUserMedia` 与 AudioWorklet capture；
- 打通 mic binary stream；
- 接入 VAD、Transcriber 与 partial/final transcript；
- 将用户开口连接到 interruption 路径。

每个切片结束时运行：

```bash
bun run typecheck
bun test
```

Stage 应用从切片二开始额外运行：

```bash
bun run build:stage
```

## 11. 已确认决策

以下决策已经确认，作为 Stage 实现基线：

1. 将仓库调整为 Bun workspaces，并让各 app 声明自身依赖；
2. 遵守单一职责，所有 UI 与 shadcn/ui 组件源码归 `apps/stage`，不建立共享 UI
   package；
3. protocol 使用共享 Zod schema，不采用 tRPC、OpenAPI 或 Protobuf；
4. 接受 v1 新增的状态快照、输入关联、字幕文本、transcript stream ID 和错误码；
5. v1 binary audio 继续依赖单活动流约束；
6. Live2D 模型默认放在 `data/stage/models/`；
7. 按六个可验证切片推进。

## 12. 参考资料

- [shadcn/ui Vite 安装](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui Monorepo](https://ui.shadcn.com/docs/monorepo)
- [shadcn/ui Tailwind CSS v4](https://ui.shadcn.com/docs/tailwind-v4)
- [Tailwind CSS Vite 安装](https://tailwindcss.com/docs/installation/using-vite)
- [Vite server proxy](https://vite.dev/config/server-options.html#server-proxy)
- [Bun WebSocket](https://bun.com/docs/runtime/http/websockets)
- [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [Live2D Cubism Web Samples](https://github.com/Live2D/CubismWebSamples)
