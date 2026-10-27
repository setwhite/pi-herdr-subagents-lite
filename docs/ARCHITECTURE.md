
# 架构

最小 package：package 根就是仓库工作目录，`src/` 放模块、`test/` 放测试、`docs/` 放文档。只做 herdr，按功能分模块，不按 controller/service/adapter 分层。

v1 目标与当前代码的差异见 [v1 契约](specs/0001-v1-contract.md) 与 [决策](decisions/README.md)；M0 的 spec、任务、审计与 E2E 记录见 [archive/m0](archive/m0/README.md)。本文只写模块边界、依赖方向、测试 seam 和文档规则；内部 API 以代码与类型为准。

入口只装配真实依赖，不持有运行态；SubagentService 由 extension 在 `session_start` 创建。

## 1. 模块

| 模块 | 职责 | 依赖 |
|---|---|---|
| extension | pi 工具、生命周期、消息信封、错误渲染、子侧 inbox 投递 | subagent、inbox；config/profile 类型、herdr/session 端口（type-only）；pi 类型 |
| subagent | run 生命周期、profile 解析与 argv、并发、命名、结果轮询、结果内容/截断、send 重启 | herdr 端口、session 读取、profile、config、inbox、Node fs |
| herdr | HerdrHost 端口 + CLI 适配 | Node child_process |
| session | 读 child session 最后一条 assistant 的文本与 toolCall 状态 | Node fs |
| inbox | `<childSession>.inbox/` 的建目录、入队、按序投递、归档与删除 | Node fs / path / crypto |
| config | 读全局 `config.json`：默认值、clamp、严格校验 | Node fs / path / os |
| profile | 读 `<agent-dir>/agents/*.md`：拆 frontmatter 与 body，校验字段；解析 skills 路径 | pi 的 `parseFrontmatter` / `getAgentDir`、Node fs / path |

入口不是模块：只构造真实 host/session、把 `agentDir()` 绑定进 `loadConfig`、注入 `loadProfiles`、导出扩展。

### extension

pi 适配层：在 `session_start` 注册工具、挂 `session_start` / `session_shutdown`；工具调用时检查 `HERDR_ENV`，把 ToolError 渲染成 `isError`；异步结果封装成 `subagent_result`。注册名、开关与工具文案来自 config；文案里的 `{{profiles}}` 在注册时用 `loadProfiles` 展开。run 的 `profile` 原样传给 subagent；profile 查询与错误在 subagent 内。

不持有 run 状态，不做并发、命名、结果轮询、截断、JSONL 解析，也不直接碰 herdr CLI。子侧 inbox 轮询与 `sendUserMessage` 投递在这里，文件操作只经 inbox。测试从注册后的工具进入。

### subagent

run 生命周期内核。对外只有 SubagentService：`run`、`send`、`onResult`、`shutdown`、`active`。

subagent 负责槽位、`<profile>-<n>` 与 pane 标签、brief、串行轮询、`completion_seq`、结果读取重试、按 `maxResultChars` 截断、done/unknown；槽位上限来自调用方传入的 `maxConcurrent`。run 先解析 profile：缺 → `unknown_profile`，坏字段 → `profile_invalid`，都发生在占槽之前。

profile 随后落成子进程参数；append / replace 另写身份文件。`cwd` 相对父 cwd 解析后交给 `createTab`；字段到参数的映射见 [v1 契约](specs/0001-v1-contract.md) 第 2 节与 [PROMPTS](PROMPTS.md) 第 3 节。

`send` 按名字查记录：活着的子代理写 inbox；已退出的重启。done 后记录保留，`active()` 与 `maxConcurrent` 只数 live。

最后一条 assistant 仍带 toolCall 时继续轮询，等反问/工具返回后的最终文本。不 import pi，不拼 herdr 命令。

### herdr

HerdrHost 端口与唯一真实适配器：`createTab`、`renameTab`、`renamePane`、`startAgent`、`resumeAgent`、`getAgent`、`hasPane`、`closeTabIfOnlyPane`。v1 增加 `listAgents`：一次 `agent list` 覆盖所有 run，父侧不再逐 run `getAgent`；再加 `readAgent`（blocked 时读 pane 末尾）。

CLI 调用全部走 `execFile` 的 argv，不经过 shell；解析 JSON；错误码里 `agent_name_taken` 归一成 `name_taken`，`agent_not_found` 在 `getAgent` 里转为 null，其余原样抛出；`hasPane` 查 `pane list` 的成员。`startAgent` 先 `agent start` 到 idle，再 `agent prompt @brief`；brief 不放进启动 argv，否则带首轮任务的长任务会让启动等待超时；`resumeAgent` 只做 `agent start`，不投 brief。profile 生成的参数由 subagent 传入，herdr 只拼接。extension/subagent 只依赖端口，测试用 fake host；真实 CLI 字段由手工 E2E 校准。

### session

`readLastAssistant(path)`：读 child session JSONL，返回最后一条 assistant 消息的 `{ text, pendingToolCall }`。text 是 text block 拼接并 trim；pendingToolCall 表示该消息仍带 toolCall。文件读不到、坏行、没有文本时 text 为 null；不重试、不 sleep、不写文件。重试和路径策略在 subagent。

### inbox

`<childSession>.inbox/` 的唯一读写口。`createInbox` 建目录；`enqueue` 先把消息写进临时文件再 rename 成按进程内单调时间排序的 `.md`，保证父侧发送顺序；`drain` 按文件名顺序读，逐条交给投递回调，成功后 rename 到 `.delivered/`，回调抛错即停并留下该文件等下一轮；`hasInbox` 只认真实目录，ENOENT 视为没有，其他 fs 错误照常抛出；`removeInbox` 删除整个目录，用于 `name_taken` 重试时清掉本次尝试。

消息文本与失败计数不属于这里：前缀由 subagent 拼（格式见 [PROMPTS](PROMPTS.md) 第 4 节），失败上限与停止后的通知由 extension 决定。

### config

`loadConfig(agentDir)` 读一次 `<agent-dir>/pi-herdr-subagents-lite/config.json`：文件不存在返回默认值；数值越界静默 clamp；未知键、类型错、枚举错合并成一条错误，消息带文件路径与字段名。agent 目录由入口用 profile 的 `agentDir()` 解析。extension 消费 `enabled`、`toolName`、`prompts`、`maxConcurrent`、`maxResultChars`、`inboxPollMs`；其余键留给后续任务。

index 注入 `loadConfig` 与 `loadProfiles`；config 在工厂里调用一次。配置无效时工厂抛错，pi 显示 extension error，工具不注册。

### profile

`loadProfiles({ cwd, trusted })` 读全局 `<agent-dir>/agents/*.md`；`trusted` 为 true 时再读 `<cwd>/.pi/agents/*.md`，同名文件由项目版本覆盖（全局的问题也一并让位）。profile 名 = 文件名（去 `.md`），YAML frontmatter 与 body 分开；字段按 [v1 契约](specs/0001-v1-contract.md) 第 2 节校验，未知字段忽略。坏字段只跳过该 profile，返回 `{ profiles, problems }`，模块自己不抛错；目录不存在时视为空。extension 在 `session_start` 用 ctx 的 `cwd` 与 `isProjectTrusted()` 取目录；subagent 每次 run 通过注入的 loader 取一次，把 problems 映射成 `profile_invalid`，把缺名字映射成 `unknown_profile`。

profile 是唯一对 pi 做运行时 import 的叶子：`parseFrontmatter` 拆 frontmatter，`getAgentDir` 定位 agent 目录（`PI_CODING_AGENT_DIR` 或 `~/.pi/agent`）。

### v1 差异

- 剩余差异：extension 的 bridge 监听与 `subagent_question` 转发；subagent 的 `<childSession>.exit` 回执。
- 子进程全局安装后也加载本包；不靠 marker 或角色检测。
- 不设 `title` / `display_agent` / `state_labels`；不使用 `pane.report_metadata` 做恢复。
- 当前代码逐 run 调 `getAgent`，每 1s 轮询一次；v1 改为 `agent list` 快照，以 [v1 契约](specs/0001-v1-contract.md) 为准。

## 2. 依赖方向

~~~text
index -> extension
index -> config
index -> herdr
index -> profile
index -> session
extension -> subagent
extension -> inbox
extension ..> config   (type-only)
extension ..> herdr    (type-only)
extension ..> profile  (type-only)
extension ..> session  (type-only)
subagent -> herdr
subagent -> profile
subagent -> session
subagent -> config
subagent -> inbox
~~~

- 只能沿箭头依赖，禁止反向 import；config、herdr、session、profile、inbox 是叶子。
- config 只认 Node fs/path/os，不 import pi，也不 import 其他模块；配置错误的唯一表达是一条带字段名的 Error。
- inbox 只认 Node fs/path/crypto，不 import 其他模块；不解析消息内容，也不记投递失败次数。
- subagent 不 import pi；extension 不 import 真实 CLI 或 fs；只有 index 同时认识真实适配器与 pi。
- 宿主包 `@earendil-works/pi-coding-agent` 在 `src/index.ts` 与 `src/extension/index.ts` 只做 type-only import，在 `src/profile/index.ts` 做运行时 import；`typebox` 只在 extension。
- bridge 是 extension 内的事件监听，不单独入口；`ui_prompt_*` 监听由 extension 注册，bridge 配置也由 extension 读取，不引入 bridge 模块。
- 上述边与「单一出口」由 `scripts/check-imports.mjs` 执行（`pnpm check:imports`）：改这张图就同步改脚本里的 `EDGES` / `SINGLE_IMPORT`；脚本只校验源码，不比对本文。

## 3. 目录与测试约定

- 模块以目录为单位：单文件模块用 `<name>/index.ts`；共享类型放拥有它的模块，跨模块只走模块入口。不建 utils/common/helpers/ports 层。
- 模块说明写在本文，不单列模块文档；改接口或语义时同步本文与 [v1 契约](specs/0001-v1-contract.md)。术语见 [GLOSSARY](GLOSSARY.md)。
- 入口 `src/index.ts` 只做 composition root + 默认导出；extension 是唯一注册工具、使用 pi 生命周期的模块。
- 结果内容与截断属于 subagent；消息信封（customType、display、triggerTurn、头部）属于 extension。错误在 herdr 映射为 host 错误，在 subagent 映射为 ToolError，extension 只渲染。
- 测试统一放 `test/`。按 seam 平铺：`config.test.ts`（配置解析）、`profile.test.ts`（profile 解析）、`inbox.test.ts`（inbox 文件）、`extension.test.ts`（工具契约 + run 生命周期 + 子侧 inbox 投递）、`session.test.ts`（纯函数表驱动）、`index.test.ts`（入口导出）。真实 herdr CLI 不进自动化测试，只做手工 E2E；等有可跑的自动化真实链路再加 `test/e2e/`。
- 唯一 mock seam 是 pi 扩展 API + 注入 HerdrHost：fake pi、fake host、fake timers、临时 session JSONL。测试不 mock SubagentService 内部，也不 mock Node fs；真实 CLI 字段由手工 E2E 校准，不写第二个 mock。
- 仓库级守卫是 `scripts/check-imports.mjs`（零依赖 node 脚本）；提交前闸是 `.githooks/pre-commit`（`git config core.hooksPath .githooks` 启用一次），与 CI 跑同一批命令。
- 收工 QA 固定四条：`pnpm lint`、`pnpm check:imports`、`pnpm typecheck`、`pnpm test`；`pnpm check` 一次跑完。
- 手动验收用隔离 agent 目录：`PI_CODING_AGENT_DIR=<临时目录>`，只从全局复制真实 `auth.json`，另写最小 `settings.json`、`keybindings.json`、`config.json` 与 `agents/explore.md`；步骤见 [e2e/herdr.md](e2e/herdr.md)。

### seam

| seam | 用法 | 覆盖 |
|---|---|---|
| pi 扩展 API + 注入 HerdrHost | fake pi、fake host、fake timers、临时 session JSONL、`PI_CODING_AGENT_DIR` 指向临时目录 | 工具契约、run 生命周期、profile argv、身份文件、并发、send 续聊与重启、结果消息 |
| loadConfig | 临时 agent 目录 + 真实 fs | 默认值、clamp、严格校验、配置错误 |
| loadProfiles | 临时 agent 目录、临时项目目录 + 真实 fs | frontmatter 与 body 拆分、字段校验、坏字段、受信项目的覆盖 |
| SessionReader | 纯函数表驱动 | JSONL 解析边界 |
| inbox | 临时 session 路径 + 真实 fs；子侧轮询经 fake pi + fake timers | 建目录、入队顺序、按序投递、归档、失败保留与停止 |
| 真实 HerdrHost + pi | 手工 E2E | CLI argv/JSON、tab/agent/close、真实 child |
| bridge（v1，extension 内） | fake pi events | `ui_prompt_*` → `herdr:blocked` |

bridge 的真实渲染另做手工 E2E。

## 4. 文档职责

| 文件 | 只写 | 不写 |
|---|---|---|
| `README.md` | 安装、用法、开发、文档索引 | 模块签名、选型理由 |
| `docs/ARCHITECTURE.md` | 模块边界、依赖方向、测试 seam、文档规则 | 字段表、决策理由 |
| `docs/decisions/*.md` | 决策编号、理由、取消项、边界与验证；一条一份 | 字段表、配置/命令行 |
| `docs/specs/*.md` | v1 对外配置、profile、工具、结果、send、bridge | 决策理由、内部签名 |
| `docs/PROMPTS.md` | 工具文案、任务简报、子代理 system prompt | 配置语义、结果协议 |
| `docs/GLOSSARY.md` | 本扩展特有术语的唯一命名来源 | 实现细节 |
| `docs/e2e/herdr.md` | 当前手工 E2E runbook | 契约与理由 |
| `docs/archive/m0/*` | M0 spec、任务、审计、E2E 记录 | 当前契约 |
| `docs/todos/*.md` | v1 任务台账、验收证据 | 契约与理由 |
| `docs/audit/*.md` | 任务验收结论与证据 | 契约与理由 |
| `docs/research/*.md` | 外部实测与参考记录 | 当前契约 |

内容归属冲突时以本表裁决；跨文档只允许指针，不允许复述。

## 5. 约束

- 不写自建 registry；子 session、brief、inbox 都只是文件，不承担恢复。
- 当前通过 `pi -e` 加载；v1 全局安装（npm），bridge 是同一扩展内的监听器。无 marker / 角色检测；子进程也加载本包。
- 任务状态只在 `docs/todos/`；M0 已完成记录移到 `docs/archive/m0/`，架构文档不写进度。
- 内部接口以代码和类型为唯一事实来源；文档只写代码里读不出的约束、决策与事实。
