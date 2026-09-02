# AMADEUS Core 逻辑问题修复计划

> 状态：已完成。
>
> 原则：只修复已经确认的行为错误；不借机增加通用框架、额外扩展点或无明确场景的防御代码。

## 1. 修复目标

本轮处理以下问题：

1. 模型可以通过 `interruptible: false` 阻止用户抢占发声；
2. Runtime 取消旧 Turn 后，没有等待旧 Utterance 真正停止；
3. CoreVoice 的 finished、interrupted、failed 路径可能并发进入；
4. 异步 Activity 通知可能乱序到达；
5. `say` 的模型可见 JSON Schema 与本地 Zod 约束不一致；
6. 多进程同时打开 SQLite 时，`busy_timeout` 设置得太晚；
7. LLM smoke test 没有严格验证脚本要求的 Tool Call 次数和内容。

前三项属于同一个核心约束：

> 新用户输入必须可靠终止旧的用户可感知发声；同一个 Utterance 只能拥有一个终态；新 Turn 只能在旧发声完成清理后开始。

## 2. 非目标

本轮不做：

- 通用任务调度器或事件总线；
- Voice 状态机框架；
- 自动重试所有 Tool Call；
- Stage 重连机制；
- 多实例协调或进程锁；
- 新的错误类型体系；
- Memory、STT 或 Stage 功能扩展。

## 3. 决策一：v0.1 的所有 Agent 发声都可被用户打断

### 3.1 当前问题

`say` 把 `interruptible` 交给模型决定，而 Runtime 同时承诺用户输入拥有最高优先级。这两项语义无法同时成立。

当模型调用：

```json
{
  "text": "...",
  "interruptible": false
}
```

新用户 Turn 会取消旧 Runner，但 Voice 会忽略打断。旧音频继续播放，新 Turn 仍会前进，并可能在再次发声时遇到 `VoiceBusyError`。

### 3.2 修复决策

v0.1 不支持不可打断的 Agent 发声。删除 `interruptible`，而不是再增加一套优先级规则。

### 3.3 代码调整

`src/tools/say.ts`：

- 从 `sayParameters` 删除 `interruptible`；
- 从模型可见 JSON Schema 删除 `interruptible`；
- 调用 `voice.say()` 时不再传递该字段。

`src/voice/voice.ts`：

- 从 `SayOptions` 删除 `interruptible`；
- 创建 `ActiveUtterance` 时不再传递该选项。

`src/voice/utterance.ts`：

- 删除 `ActiveUtteranceOptions.interruptible`；
- 删除 `#interruptible`；
- `interrupt()` 对所有 pending Utterance 生效。

### 3.4 测试调整

- 删除“non-interruptible utterance ignores interruption”测试；
- 增加或保留“interrupt 对 pending Utterance 生效且幂等”的测试；
- `sayTool` 测试确认模型参数中不再存在 `interruptible`；
- Runtime 抢占测试使用真实的异步 Voice 结束边界，而不只检查 `interrupt()` 被调用。

## 4. 决策二：Runtime handoff 同时等待 Runner 和 Utterance

### 4.1 当前问题

`AmadeusRuntime` 的 handoff 只串行化 Agent run。`voice.interrupt()` 会启动异步 Stage 清理，但 Runtime 没有等待清理完成。

可能出现以下顺序：

```text
旧 Turn 正在 say
  ↓
新用户 Turn 到达
  ↓
Runtime 请求 Voice interrupt，并 abort 旧 Runner
  ↓
Runner 很快结束
  ↓
新 Runner 启动
  ↓
旧 Voice 仍在等待 speaker.stop / utterance.end
  ↓
新 say 抛出 VoiceBusyError
```

### 4.2 修复决策

Runtime 在其 Voice 包装层记录当前 `Utterance`。旧 Turn 被取消时，handoff 必须等待该 Utterance 的 `done` settle，然后才能启动新 Turn。

不改变公开的 `Amadeus.interrupt(): void`，也不把 `Voice.interrupt()` 扩展成新的异步协议。

### 4.3 代码调整

`src/amadeus.ts`：

- 增加当前 Utterance 引用或等价的内部 settle Promise；
- 包装后的 `voice.say()` 保存返回的 Utterance；
- Utterance settle 后仅在仍为同一对象时清理引用；
- 取消 active Turn 时仍立即调用 `voice.interrupt()` 和 `AbortController.abort()`；
- 被取消的 run 在恢复 `idle`、释放 handoff 前，等待对应 Utterance settle；
- Utterance 的正常 reject 只表示它已经结束，不应阻止后续用户 Turn。

这里等待的是已经存在的真实动作边界，不增加超时或强制清理兜底。若 Stage 永远不完成停止，Runtime 也不应假装 Voice 已经空闲。

### 4.4 必须保持的行为

- 新输入到达时，打断请求仍立即发出；
- 等待清理期间不启动新 Agent run；
- 连续快速提交多个 Turn 时，只有最新 generation 运行；
- 显式 `runtime.interrupt()` 后，Activity 只能在真实 Utterance settle 后回到 `idle`；
- Voice 基础设施失败导致 `done` reject 时，handoff 仍可继续。

### 4.5 回归测试

增加一个可控异步 Voice：`interrupt()` 只记录请求，直到测试主动 resolve Utterance。

验证：

1. 旧 Runner 已完成但旧 Utterance 未 settle 时，新 Runner 不启动；
2. Utterance settle 后，新 Runner 才启动；
3. 等待期间 Activity 不错误地报告 `idle`；
4. Utterance reject 后最新 Turn 仍能启动；
5. 三个快速 Turn 仍只执行最后一个。

## 5. 决策三：Utterance 终态必须先同步占有，再异步清理

### 5.1 当前问题

成功、失败和打断路径都会先发送若干 Stage 消息，最后才改变 `ActiveUtterance` 状态。异步发送期间，其他终态路径仍会认为 Utterance 是 pending。

两个已确认的竞态：

```text
speaker.played
  ↓
finished 路径正在发送 utterance.end
  ↓
stageDisconnected()
  ↓
failed 路径也开始
```

```text
stageDisconnected()
  ↓
failed 路径正在清理
  ↓
interrupt()
  ↓
interrupted 路径也开始
```

### 5.2 修复决策

把“取得终态所有权”和“完成异步清理”分开：

1. finished、interrupted 或 failed 路径先同步取得唯一所有权；
2. 未取得所有权的其他路径立即退出；
3. 所有者执行对应 Stage 清理；
4. 清理结束后才 resolve/reject `done`。

不能只增加更多 `failureHandled` 布尔值，因为那仍会让三个终态分别维护互相重叠的条件。

### 5.3 状态调整

`ActiveUtterance` 内部增加必要的过渡状态，例如：

```text
pending
  ├─ finishing   → finished
  ├─ interrupting → interrupted
  └─ failing     → failed
```

具体命名可以在实现时微调，但必须满足：

- 从 `pending` 进入某个过渡态是同步且仅成功一次的操作；
- 进入过渡态后，其他终态入口不能再改变所有权；
- interruption 和 failure 一旦取得所有权，立即 abort synthesis；
- `done` 仍在 Stage 清理结束后 settle；
- `CoreVoice.#active` 仍在清理结束时释放。

### 5.4 CoreVoice 调整

`src/voice/voice.ts`：

- successful playback 后先 claim finishing，再发送 finished 结束消息；
- interruption handler 先 claim interrupting，再发送 stop/end；
- failure handler 先 claim failing，再发送 stop/error/end；
- `stageDisconnected()` 只触发 failure 竞争，不直接形成第二套终态判断；
- 删除被统一状态所有权取代的 `interruptionHandled` 和 `failureHandled`；
- 迟到的 `speaker.played`、Stage disconnect 和 interrupt 都不能覆盖已有终态。

### 5.5 回归测试

使用可暂停 `StageLink.send()` 的 fake，覆盖：

1. `speaker.played` 后、finished 清理完成前发生 disconnect；
2. failed 清理期间发生 interrupt；
3. interrupted 清理期间发生 disconnect；
4. 失败取得所有权后不再发送后续音频帧；
5. 每个 Utterance 只发送一种 `utterance.end.status`；
6. `done` 只 settle 一次，且结果与唯一终态一致；
7. 清理完成前新的 `say()` 仍保持 busy，完成后可以继续。

## 6. 决策四：Activity observer 按状态产生顺序执行

### 6.1 当前问题

`onActivity` 允许返回 Promise，但每次调用都是独立的 fire-and-forget。较慢的旧通知可能晚于新通知完成，使 Stage 最终停留在过期状态。

### 6.2 修复决策

Runtime 内部维护一条轻量 Promise 链，按 `#setActivity()` 的调用顺序执行 observer。

```text
thinking → speaking → thinking → idle
```

observer 最终看到的顺序必须相同。通知链不阻塞 Agent run；单次通知失败被吞掉，但不能中断后续通知。

这不是 Event Bus，只是为现有异步 callback 落实其顺序语义。

### 6.3 回归测试

- 第一个 observer Promise 延迟完成，后续状态不得越过它；
- 某次 observer reject 后，后续状态仍会收到；
- Runtime 内存中的 `activity` 仍然同步更新，不等待 observer。

## 7. 决策五：统一 `say` 的模型约束与本地约束

### 7.1 当前问题

`emotion: ""` 符合当前 JSON Schema，却会被本地 Zod `.trim().min(1)` 拒绝。纯空白字符串也存在同类差异。

### 7.2 修复决策

继续保留非严格 JSON Schema，因为 DeepSeek 与 Agents SDK 的兼容性已经通过真实测试确认；只同步两份必要约束。

模型可见 schema 中：

- `text` 保持 `minLength: 1`，增加至少一个非空白字符的约束；
- `emotion` 增加 `minLength: 1` 和至少一个非空白字符的约束；
- 删除 `interruptible`；
- `speed > 0` 保持不变。

本地 Zod 继续负责 trim、默认行为和最终执行前验证。

### 7.3 回归测试

- 空或纯空白 `text` 被拒绝；
- 空或纯空白 `emotion` 不符合模型 schema，也被本地校验拒绝；
- 合法的 text、emotion、speed 正常传给 Voice；
- 省略可选字段仍能正常执行。

## 8. SQLite 启动锁问题

### 8.1 范围

当前产品是单 Amadeus 进程，正常路径不会触发该问题。但并发启动两个实例时已经实际复现 `SQLITE_BUSY_RECOVERY`，因此做一个局部顺序修正。

### 8.2 修复

在 `src/storage/sqlite.ts` 中，将：

```sql
PRAGMA busy_timeout = 5000;
```

移动到可能取得写锁的：

```sql
PRAGMA journal_mode = WAL;
```

之前。

不增加文件锁、重试循环或多实例协调。

### 8.3 验证

- 保留现有 migration、foreign key、持久化测试；
- 使用临时数据库重复并发启动压力验证；
- 压力脚本只用于验证，不进入常规单元测试，避免引入进程调度导致的随机失败。

## 9. 收紧 LLM smoke test

`scripts/smoke-llm.ts` 应验证脚本实际声明的行为：

- 第一轮只新增一次语音，内容严格为 `Stored`；
- 数据库关闭并重新打开；
- 第二轮只新增一次语音；
- 第二轮语音严格等于随机短语，而不是仅检查 `includes()`；
- Session item 数量只要求增长，不固定为某个精确值，因为模型响应条目结构可能变化；
- 临时数据库仍在 finally 中清理；
- tracing 继续关闭；
- smoke 继续与普通 `bun test` 分离，避免默认产生 API 费用。

这会让 smoke 对模型指令遵循更敏感，但失败时能明确区分“历史未恢复”和“Tool Call 行为不符合要求”。

## 10. 实施顺序

按依赖关系实施：

1. 删除不可打断参数及相关测试；
2. 重整 ActiveUtterance 的终态所有权；
3. 调整 CoreVoice 的成功、打断、失败路径；
4. 让 Runtime handoff 等待 Utterance settle；
5. 保序 Activity observer；
6. 对齐 `say` schema；
7. 调整 SQLite PRAGMA 顺序；
8. 收紧 smoke 断言；
9. 更新主设计文档中有关 interruption 的接口示例；
10. 执行全部验证并单独提交。

终态所有权必须先于 Runtime 等待逻辑完成，否则 Runtime 的新测试会依赖尚未可靠的 `done` 边界。

## 11. 验收标准

### 11.1 自动测试

```text
bun run typecheck
bun test
```

必须全部通过，且新增测试至少覆盖：

- 异步打断清理阻止新 Turn 提前启动；
- 三种终态竞态只能产生一个结果；
- Activity observer 保序；
- `say` schema 边界一致。

### 11.2 真实集成测试

显式执行：

```text
bun run smoke:llm
```

必须验证 DeepSeek Responses API、结构化输出、`say`、流式 Runtime 与 SQLite 重开后的历史恢复。

### 11.3 静态检查

```text
git diff --check
```

并确认：

- 源码中不再存在 Agent 可配置的 `interruptible`；
- 每个 Utterance 只有一条终态所有权路径；
- `.env` 未被暂存或输出；
- 没有新增框架式抽象或与本轮无关的功能。

## 12. 预计改动文件

```text
apps/amadeus/src/amadeus.ts
apps/amadeus/src/amadeus.test.ts
apps/amadeus/src/tools/say.ts
apps/amadeus/src/tools/say.test.ts
apps/amadeus/src/voice/voice.ts
apps/amadeus/src/voice/voice.test.ts
apps/amadeus/src/voice/utterance.ts
apps/amadeus/src/voice/utterance.test.ts
apps/amadeus/src/storage/sqlite.ts
apps/amadeus/scripts/smoke-llm.ts
docs/AMADEUS_DESIGN_ZH_ACTION_VOICE.md
```

除上述文件和本计划文档外，不应扩散修改范围。

## 13. 实施结果

本计划于 2026-09-02 按上述边界完成：

- Agent 不再能够产生不可打断的发声；
- Runtime 会等待旧 Utterance settle 后再开始新 Turn；
- finished、interrupted、failed 在异步清理前取得唯一终态所有权；
- Activity observer 按状态产生顺序执行；
- `say` 的 JSON Schema 与本地必填字符串约束保持一致；
- SQLite 在请求 WAL 锁前设置 `busy_timeout`；
- LLM smoke 严格检查两轮各自的发声次数和内容。

验证结果：

- TypeScript 类型检查通过；
- 48 项单元测试通过；
- 16 个进程并发打开同一临时 SQLite 数据库全部成功；
- 真实 DeepSeek 双轮 smoke test 通过；
- `.env` 未进入 Git 变更。
