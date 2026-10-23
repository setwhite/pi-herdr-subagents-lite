
# 架构

当前代码是 M0：最小 package，package 根就是仓库工作目录，`src/` 放模块、`test/` 放测试、`docs/` 放文档。只做 herdr，按功能分模块，不按 controller/service/adapter 分层。

v1 目标与当前代码的差异见 [CONTRACT](CONTRACT.md) 与 [DECISIONS](DECISIONS.md)；M0 的 spec、任务、审计与 E2E 记录见 [archive/m0](archive/m0/README.md)。本文只写模块边界、依赖方向、测试 seam 和文档规则；内部 API 以代码与类型为准。

入口只装配真实依赖，不持有运行态；SubagentService 由 extension 在 `session_start` 创建。

## 1. 模块

| 模块 | 职责 | 依赖 |
|---|---|---|
| extension | pi 工具、生命周期、消息信封、错误渲染 | subagent；herdr/session 端口（type-only）；pi 类型 |
| subagent | run 生命周期、并发、命名、轮询、结果内容/截断 | herdr 端口、session 读取、Node fs |
| herdr | HerdrHost 端口 + CLI 适配 | Node child_process |
| session | 读 child session 最后一条 assistant 的文本与 toolCall 状态 | Node fs |

入口不是第五个模块：只构造真实 host/session 并导出扩展。

### extension

pi 适配层：注册工具、检查 `HERDR_ENV`、挂 `session_start` / `session_shutdown`、把结果封装成 `subagent_result`、把 ToolError 渲染成 `isError`。

不持有 run 状态，不做并发、命名、轮询、截断、JSONL 解析，也不直接碰 herdr CLI。测试从注册后的工具进入。

### subagent

run 生命周期内核。对外只有 SubagentService：`run`、`onResult`、`shutdown`、`active`。

M0 负责 4 个槽、`worker-N`、run root/brief、串行轮询、`completion_seq`、结果读取重试、超过 16384 字符截断、done/unknown。最后一条 assistant 仍带 toolCall 时继续轮询，等反问/工具返回后的最终文本。不 import pi，不拼 herdr 命令；run root 是临时目录，不承担恢复。

### herdr

HerdrHost 端口与唯一真实适配器：`createTab`、`renameTab`、`startAgent`、`getAgent`、`closeTabIfOnlyPane`。

CLI 调用全部走 `execFile` 的 argv，不经过 shell；解析 JSON；错误码里 `agent_name_taken` 归一成 `name_taken`，`agent_not_found` 在 `getAgent` 里转为 null，其余原样抛出。`startAgent` 先 `agent start` 到 idle，再 `agent prompt @brief`；brief 不放进启动 argv，否则带首轮任务的长任务会让启动等待超时。extension/subagent 只依赖端口，测试用 fake host；真实 CLI 字段由手工 E2E 校准。

### session

`readLastAssistant(path)`：读 child session JSONL，返回最后一条 assistant 消息的 `{ text, pendingToolCall }`。text 是 text block 拼接并 trim；pendingToolCall 表示该消息仍带 toolCall。文件不存在、坏行、没有文本时 text 为 null；不重试、不 sleep、不写文件。重试和路径策略在 subagent。

### v1 差异

- extension 增加 `send`；subagent 增加 profile、配置、`<profile>-<n>`、inbox；新增 bridge 入口。
- 子进程全局安装后也加载本包；不靠 marker 或角色检测。
- 不设 `title` / `display_agent` / `state_labels`；不使用 `pane.report_metadata` 做恢复。
- 当前 M0 的 `worker-N`、4 槽、1s 轮询、无配置是历史行为；v1 以 [CONTRACT](CONTRACT.md) 为准。

## 2. 依赖方向

~~~text
index -> extension
index -> herdr
index -> session
extension -> subagent
extension ..> herdr    (type-only)
extension ..> session  (type-only)
subagent -> herdr
subagent -> session
~~~

- 只能沿箭头依赖，禁止反向 import；herdr、session 是叶子。
- subagent 不 import pi；extension 不 import 真实 CLI 或 fs；只有 index 同时认识真实适配器与 pi。
- 宿主包 `@earendil-works/pi-coding-agent` 只以 type-only 出现在 `src/index.ts` 与 `src/extension/index.ts`；`typebox` 只在 extension。
- bridge 是 v1 第二个入口 `src/bridge/index.ts`：只依赖 pi 类型，监听 `ui_prompt_*`，不 import 其他模块。
- 上述边与「单一出口」由 `scripts/check-imports.mjs` 执行（`pnpm check:imports`）：改这张图就同步改脚本里的 `EDGES` / `SINGLE_IMPORT`，两边不一致 CI 会红。

## 3. 目录与测试约定

- 模块以目录为单位：单文件模块用 `<name>/index.ts`；共享类型放拥有它的模块，跨模块只走模块入口。不建 utils/common/helpers/ports 层。
- 模块说明写在本文，不单列模块文档；改接口或语义时同步本文与 [CONTRACT](CONTRACT.md)。术语见 [GLOSSARY](GLOSSARY.md)。
- 入口 `src/index.ts` 只做 composition root + 默认导出；extension 是唯一注册工具、使用 pi 生命周期的模块。
- 结果内容与截断属于 subagent；消息信封（customType、display、triggerTurn、头部）属于 extension。错误在 herdr 映射为 host 错误，在 subagent 映射为 ToolError，extension 只渲染。
- 测试统一放 `test/`。M0 只有一条 mock seam，按 seam 平铺：`extension.test.ts`（工具契约 + run 生命周期）、`session.test.ts`（纯函数表驱动）、`index.test.ts`（入口导出）。真实 herdr CLI 不进自动化测试，只做手工 E2E；等有可跑的自动化真实链路再加 `test/e2e/`。
- 唯一 mock seam 是 pi 扩展 API + 注入 HerdrHost：fake pi、fake host、fake timers、临时 session JSONL。测试不 mock SubagentService 内部，也不 mock Node fs；真实 CLI 字段由手工 E2E 校准，不写第二个 mock。
- 仓库级守卫是 `scripts/check-imports.mjs`（零依赖 node 脚本）；提交前闸是 `.githooks/pre-commit`（`git config core.hooksPath .githooks` 启用一次），与 CI 跑同一批命令。
- 收工 QA 固定四条：`pnpm lint`、`pnpm check:imports`、`pnpm typecheck`、`pnpm test`；`pnpm check` 一次跑完。
- 手动验收用隔离 agent 目录：`PI_CODING_AGENT_DIR=<临时目录>`，只放真实 `auth.json` 与最小 `settings.json`；步骤见 [e2e/herdr.md](e2e/herdr.md)。

### seam

| seam | 用法 | 覆盖 |
|---|---|---|
| pi 扩展 API + 注入 HerdrHost | fake pi、fake host、fake timers、临时 session JSONL | 工具契约、run 生命周期、并发、结果消息 |
| SessionReader | 纯函数表驱动 | JSONL 解析边界 |
| 真实 HerdrHost + pi | 手工 E2E | CLI argv/JSON、tab/agent/close、真实 child |
| bridge（v1） | fake pi events | `ui_prompt_*` → `herdr:blocked` |

bridge 的真实渲染另做手工 E2E。

## 4. 文档职责

| 文件 | 只写 | 不写 |
|---|---|---|
| `README.md` | 安装、开发、文档索引 | 模块签名、选型理由 |
| `docs/ARCHITECTURE.md` | 模块边界、依赖方向、测试 seam、文档规则 | 字段表、决策理由 |
| `docs/DECISIONS.md` | 决策编号、理由、取消项、边界与验证 | 字段表、配置/命令行 |
| `docs/CONTRACT.md` | v1 对外配置、profile、工具、结果、send、bridge | 决策理由、内部签名 |
| `docs/PROMPTS.md` | 工具文案、任务简报、子代理 system prompt | 配置语义、结果协议 |
| `docs/GLOSSARY.md` | 本扩展特有术语的唯一命名来源 | 实现细节 |
| `docs/e2e/herdr.md` | 当前手工 E2E runbook | 契约与理由 |
| `docs/archive/m0/*` | M0 spec、任务、审计、E2E 记录 | 当前契约 |
| `docs/todos/*.md` | v1 任务台账、验收证据 | 契约与理由 |
| `docs/research/*.md` | 外部实测与参考记录 | 当前契约 |

内容归属冲突时以本表裁决；跨文档只允许指针，不允许复述。

## 5. 约束

- M0 不写自建 registry；run root/brief 是临时目录，不承担恢复。
- M0 通过 `pi -e` 加载；v1 全局安装（npm），bridge 走第二个入口。无 marker / 角色检测；子进程也加载本包。
- 任务状态只在 `docs/todos/`；M0 已完成记录移到 `docs/archive/m0/`，架构文档不写进度。
- 内部接口以代码和类型为唯一事实来源；文档只写代码里读不出的约束、决策与事实。
