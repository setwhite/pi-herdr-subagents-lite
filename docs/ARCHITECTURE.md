# 架构

最小 package：package 根就是仓库工作目录，`src/` 放模块、`test/` 放测试、`docs/` 放文档。只做 herdr，按职责分模块，不按 controller/service/adapter 分层。

本文只写模块边界、依赖方向、命名与拆分规则、测试 seam、文档规则；内部 API 以代码与类型为准。v1 对外契约见 [v1 契约](specs/0001-v1-contract.md)，理由见 [决策](decisions/README.md)，任务与进度见 [任务台账](todos/README.md)。

**迁移状态**：第 2、3 节的表是目标结构；第 2 节「迁移」列是每个模块的落地任务，未标任务的已就位。迁移完成前，`scripts/check-imports.mjs` 的 `EDGES` 是实际的依赖边。

## 1. 命名与拆分规则

- 模块名是职责的普通名词，小写、单数：`config`、`profile`、`inbox`、`bridge`、`run`。禁用看不出职责的词：`utils`、`common`、`helpers`、`core`、`ports`、`service`、`manager`。
- 一个模块 = 一个目录；对外只经 `index.ts`，其他文件不出模块。
- 模块内文件按职责命名，一个文件一件事，用单数普通名词或动词；不用 `-er` / `-or` 结尾的施动者名（`poller.ts`、`handler.ts`）。
- 单文件上限 150 行，超过就拆；按「谁变」拆，不按「谁像」拆：一侧改而另一侧不动的代码放两个文件。
- 类型放在使用它最多的模块；跨模块只从模块入口 import。

## 2. 模块

| 模块 | 职责 | 对外 | 文件 | 迁移 |
|---|---|---|---|---|
| `index.ts` | composition root：构造真实依赖，导出扩展 | `default` | — | 同 |
| `extension` | pi 装配：注册工具、挂 `session_start` / `session_shutdown`、子侧 inbox 泵、退出回执、父会话收尾 | `createExtension`、`ExtensionDeps`、`ExtensionRegistrar`、`SessionContext`、`SubagentTool` | `index.ts` `auto-exit.ts` | 同，瘦身 |
| `tool` | 模型面：参数 schema、文案、错误渲染、结果与提问消息信封 | `createTool`、`SubagentTool`、`sendResult`、`ResultMessage` | `index.ts` `schema.ts` `text.ts` `errors.ts` `message.ts` | 从 `extension` 拆（T20） |
| `run` | run 生命周期：槽位、命名、启动、轮询、结果、聚合、send、关闭 | `createRunService`、`ToolError`、`profileLabel`、`RunService`、`RunServiceDeps`、`RunStarted`、`SendResult`、`RunResult`、`ResultHandler`、`AUTO_EXIT_ENV` | `index.ts` `start.ts` `naming.ts` `resolve.ts` `truncate.ts` `spawn-args.ts` `poll.ts` `result.ts` `send.ts` `state.ts` `errors.ts`（T19）、`close.ts`（T22）、`find.ts`（T26）；`aggregate.ts`（T30） | 原 `subagent`（T19） |
| `herdr` | herdr CLI 端口 | `HerdrHost`、`createHerdrHost`、`HerdrHostError`、`AgentSnapshot`、`AgentEntry`、`StartAgentInput`、`ResumeAgentInput` | `index.ts` `cli.ts` `agent.ts` `pane.ts` | 同，拆文件（T21） |
| `session-file` | session 旁边的文件：最后一条 assistant、`.exit` 回执 | `readLastAssistant`、`SessionReader`、`readExitReceipt`、`ExitReceiptReader`、`writeExitReceipt`、`ExitReceiptWriter`、`ExitReceipt` | `index.ts` `jsonl.ts` `receipt.ts` | 原 `session`（T21） |
| `inbox` | `<childSession>.inbox/` 文件协议与子侧泵 | `createInbox`、`enqueue`、`drain`、`hasInbox`、`inboxCount`、`removeInbox`、`pumpInbox` | `index.ts` `pump.ts` | 同，泵从 `extension` 迁入（T21） |
| `config` | 全局配置读取与严格校验 | `loadConfig`、`dataDir`、`Config`、`isRaw`、`Raw` | `index.ts` `schema.ts` | 同，拆文件（T21） |
| `profile` | profile 读取、校验、分层 | `loadProfiles`、`agentDir`、`skillPath`、`Profile`、`ProfileCatalog`、`ProfileSources` | `index.ts` `frontmatter.ts` `layers.ts` | 同，拆文件（T21） |
| `bridge` | `ui_prompt_*` → `herdr:blocked`，按 `bridge.enabled` / `blockedOn` 过滤 | `createBridge` | `index.ts` | 从 `extension` 拆（T28） |

入口不是模块：只构造真实 host、配置、profile 加载器、session 读取器，把它们注入 `createExtension`。

## 3. 依赖方向

~~~text
index -> extension
index -> config
index -> herdr
index -> profile
index -> session-file
extension -> tool
extension -> run
extension ..> config   (type-only)
extension ..> herdr    (type-only)
extension ..> profile  (type-only)
extension -> bridge
extension -> inbox
extension ..> session-file (type-only)
tool -> run
tool ..> config       (type-only)
tool ..> profile      (type-only)
run -> herdr
run -> profile
run -> session-file
run -> inbox
run -> config
bridge -> config
profile -> config
~~~

- 只能沿箭头依赖，禁止反向 import；`config`、`herdr`、`session-file`、`inbox` 是叶子。
- `config` 只认 Node fs/path/os，不 import pi；配置错误的唯一表达是一条带字段名的 Error。
- `inbox` 只认 Node fs/path/crypto，不解析消息内容，不记投递失败次数；泵的每拍动作由调用方注入。
- `run` 不 import pi；`extension` 不 import 真实 CLI 或 fs；只有 `index.ts` 同时认识真实适配器与 pi。
- 宿主包 `@earendil-works/pi-coding-agent` 在 `src/index.ts`、`src/extension/index.ts`、`src/tool/index.ts` 只做 type-only import，在 `src/profile/` 做运行时 import；`typebox` 只在 `tool/schema.ts`。
- 上述边与「单一出口」由 `scripts/check-imports.mjs` 执行（`pnpm check:imports`）：改这张图就同步改脚本里的 `EDGES` / `SINGLE_IMPORT`；脚本只校验源码，不比对本文。

## 4. 模块说明

### extension

pi 适配层，不持有 run 状态。`session_start` 装配 run 服务、按 `config.enabled` 注册工具、启动子侧 inbox 泵。工具的 `HERDR_ENV` 检查、文案展开与错误渲染在 `tool`，extension 只注入配置、profile 与 service 取用函数。

### tool

模型的唯一入口：两个 action、一份参数 schema、一份文案。异步结果与提问的信封（`subagent_result`、`subagent_question`，customType、display、triggerTurn、头部格式）在这里；结果正文与截断属于 `run`。

### run

run 生命周期内核。run 先解析 profile（缺 → `unknown_profile`，坏字段 → `profile_invalid`，都在占槽之前），再占槽、命名、建 pane、启动、投 brief。轮询每拍一次 `agent list` 快照，按 `pane_id` 与 name 定位 run，比较完成序号，读子 session 尾部，投递后前移游标。`send` 按名字查记录：活着写 inbox，已退出则重启续聊。`close` 决定何时关 tab：只有 `auto-exit: true` 与命中 `closeChildrenOn` 才关。

### herdr

`HerdrHost` 端口与唯一真实适配器。CLI 调用全部走 `execFile` 的 argv，不经 shell；解析 JSON；`agent_name_taken` 归一成 `name_taken`，其余原样抛出。`startAgent` 先 `agent start` 到 idle，再 `agent prompt @brief`；brief 不放进启动 argv，否则带首轮任务的长任务会让启动等待超时。`resumeAgent` 只做 `agent start`。`listAgents` 一次 `agent list` 覆盖所有 agent；字段依据见 `docs/research/herdr-agent-list.md`。

### session-file

`readLastAssistant` 返回最后一条 assistant 的 `{ text, pendingToolCall }`；文件读不到、坏行、没有文本时 text 为 null，不重试、不 sleep。

`writeExitReceipt` 写 `<sessionFile>.exit` 的 `{ reason }`；`readExitReceipt` 读回执，缺失或坏 JSON 返回 null。

### inbox

`<childSession>.inbox/` 的唯一读写口。`enqueue` 先写临时文件再 rename 成按进程内单调时间排序的 `.md`；`drain` 按文件名顺序逐条投递，成功后 rename 到 `.delivered/`，回调抛错即停并留下该文件。`pumpInbox` 每 `pollMs` 调一次调用方注入的 `tick`，每拍结果经 `onCycle` 交回调用方；消息前缀、失败计数与上限都不在这里。

### config / profile

`loadConfig` 读一次 `<data-dir>/config.json`：不存在取默认值，数值越界静默 clamp，未知键、类型错、枚举错合并成一条带路径与字段名的错误；无效时不注册工具。`loadProfiles` 读全局与受信项目的 `profiles/*.md`，同名项目覆盖全局；坏字段只跳过该 profile，返回 `{ profiles, problems }`，模块自己不抛错。

### bridge

同一扩展内的监听器，不单独入口。`ui_prompt_start` / `ui_prompt_end` → emit `herdr:blocked` `{ active, label }`；`label` 取 `title`，没有则取 `kind`。`bridge.enabled: false` 或 `blockedOn: []` 不上报。

## 5. 测试 seam

| seam | 用法 | 覆盖 |
|---|---|---|
| pi 扩展 API + 注入 HerdrHost | fake pi、fake host、fake timers、临时 session JSONL、`PI_CODING_AGENT_DIR` 指向临时目录 | 工具契约、run 生命周期、profile argv、身份文件、并发、send 续聊与重启、结果消息、聚合、关闭 |
| `loadConfig` | 临时 agent 目录 + 真实 fs | 默认值、clamp、严格校验 |
| `loadProfiles` | 临时 agent 目录、临时项目目录 + 真实 fs | frontmatter、字段校验、坏字段、受信项目覆盖 |
| `readLastAssistant` | 纯函数表驱动 | JSONL 解析边界 |
| `inbox` | 临时 session 路径 + 真实 fs；子侧泵经 fake pi + fake timers | 建目录、入队顺序、按序投递、归档、失败保留 |
| bridge | fake pi events | `ui_prompt_*` → `herdr:blocked`、`blockedOn` 过滤 |
| 真实 HerdrHost + pi | 手工 E2E | CLI argv/JSON、tab/agent/read/close、真实 child |

唯一 mock 是 pi 扩展 API + 注入的 `HerdrHost`：不 mock 模块内部，不 mock Node fs。真实 herdr 行为变化先补 [研究记录](research/) 再改代码；手工步骤见 [e2e/herdr.md](e2e/herdr.md)。

## 6. 文档职责

| 文件 | 只写 | 不写 |
|---|---|---|
| `README.md` | 安装、用法、开发、文档索引 | 模块签名、选型理由 |
| `docs/ARCHITECTURE.md` | 模块边界、依赖方向、命名与拆分规则、测试 seam、文档规则 | 字段表、决策理由、进度 |
| `docs/decisions/*.md` | 决策编号、理由、取消项、边界与验证；一条一份 | 字段表、配置/命令行 |
| `docs/specs/*.md` | v1 对外配置、profile、工具、结果、send、bridge | 决策理由、内部签名 |
| `docs/PROMPTS.md` | 工具文案、任务简报、子代理 system prompt | 配置语义、结果协议 |
| `docs/GLOSSARY.md` | 本扩展特有术语的唯一命名来源 | 实现细节 |
| `docs/e2e/herdr.md` | 当前手工 E2E runbook | 契约与理由 |
| `docs/todos/*.md` | 任务台账、验收证据 | 契约与理由 |
| `docs/audit/*.md` | 任务验收结论与证据 | 契约与理由 |
| `docs/research/*.md` | 外部实测与参考记录 | 当前契约 |

内容归属冲突时以本表裁决；跨文档只允许指针，不允许复述。

## 7. 约束

- 不写自建 registry；子 session、brief、inbox 都只是文件，不承担恢复（D38）。
- 不靠 marker 或角色检测；子进程也加载本包，角色只看 `inbox` 目录（D46）。
- 不设 `title` / `display_agent` / `state_labels`；不使用 `pane.report_metadata`（D33）。
- 收工 QA 固定四条：`pnpm lint`、`pnpm check:imports`、`pnpm typecheck`、`pnpm test`；`pnpm check` 一次跑完。
- 手动验收用隔离 agent 目录：`PI_CODING_AGENT_DIR=<临时目录>`，只从全局复制真实 `auth.json`，另写最小 `settings.json`、`keybindings.json`、`config.json` 与 `profiles/explore.md`（D53）。

## 8. 未实现

行为差与任务号只在 [任务台账](todos/README.md)；本文不重复。任务状态只在 `docs/todos/`。
