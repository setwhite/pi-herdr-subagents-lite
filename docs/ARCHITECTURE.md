# 架构

M0 是一个最小 package，package 根就是仓库工作目录：代码在 `src/`，测试在 `test/`，文档在 `docs/`。只做 herdr；按功能分模块，不按 controller/service/adapter 分层。行为与验收见 `docs/specs/0001-m0-minimal-subagent.md`；v1 决策见 `docs/DECISIONS.md`。

入口只装配真实依赖，不持有运行态；SubagentService 由 extension 在 `session_start` 创建。

## 1. 模块

| 模块 | 职责 | 公开接口 | 依赖 | 模块文档 |
|---|---|---|---|---|
| extension | pi 工具、生命周期、消息信封、错误渲染 | createExtension(deps) | subagent；herdr/session 端口（type-only）；pi 类型 | [extension](modules/extension.md) |
| subagent | run 生命周期、并发、命名、轮询、结果内容/截断 | SubagentService、RunStarted、ToolError、SubagentResult | herdr 端口、session 读取、Node fs | [subagent](modules/subagent.md) |
| herdr | HerdrHost 端口 + CLI 适配 | HerdrHost | Node child_process | [herdr](modules/herdr.md) |
| session | 读 child session 最后一条 assistant 的文本与 toolCall 状态 | readLastAssistant(path) | Node fs | [session](modules/session.md) |

入口不是第五个模块：只构造真实 host/session 并导出扩展。

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
- 上述边与「单一出口」由 `scripts/check-imports.mjs` 执行（`pnpm check:imports`）：改这张图就同步改脚本里的 `EDGES` / `SINGLE_IMPORT`，两边不一致 CI 会红。

## 3. 目录与测试约定

- 模块以目录为单位：单文件模块用 `<name>/index.ts`；共享类型放拥有它的模块，跨模块只走模块入口。不建 utils/common/helpers/ports 层。
- 模块文档统一放 `docs/modules/<module>.md`，与模块同名；改接口或语义时同步更新。术语见 `docs/GLOSSARY.md`。
- 入口 `src/index.ts` 只做 composition root + 默认导出；extension 是唯一注册工具、使用 pi 生命周期的模块。
- 结果内容与截断属于 subagent；消息信封（customType、display、triggerTurn、头部）属于 extension。错误在 herdr 映射为 host 错误，在 subagent 映射为 ToolError，extension 只渲染。
- 测试统一放 `test/`。M0 只有一条 mock seam，所以按 seam 平铺而不是按模块建目录：`extension.test.ts`（工具契约 + run 生命周期）、`session.test.ts`（纯函数表驱动）、`index.test.ts`（入口导出）。真实 herdr CLI 不进自动化测试，只做手工 E2E；等有可跑的自动化真实链路再加 `test/e2e/`。
- 唯一 mock seam 是 pi 扩展 API + 注入 HerdrHost：fake pi、fake host、fake timers、临时 session JSONL。测试不 mock SubagentService 内部，也不 mock Node fs；真实 CLI 字段由手工 E2E 校准，不写第二个 mock。
- 仓库级守卫是 `scripts/check-imports.mjs`（零依赖 node 脚本）；提交前闸是 `.githooks/pre-commit`（`git config core.hooksPath .githooks` 启用一次），与 CI 跑同一批命令。
- 收工 QA 固定四条：`pnpm lint`、`pnpm check:imports`、`pnpm typecheck`、`pnpm test`；`pnpm check` 一次跑完。
- 手动验收用隔离 agent 目录：`PI_CODING_AGENT_DIR=<临时目录>`，只放真实 `auth.json` 与最小 `settings.json`；步骤见 spec 与 `docs/todos/T07.md`、`docs/todos/T08.md`。

### seam

| seam | 用法 | 覆盖 |
|---|---|---|
| pi 扩展 API + 注入 HerdrHost | fake pi、fake host、fake timers、临时 session JSONL | 工具契约、run 生命周期、并发、结果消息 |
| SessionReader | 纯函数表驱动 | JSONL 解析边界 |
| 真实 HerdrHost + pi | 手工 E2E | CLI argv/JSON、tab/agent/close、真实 child |

## 4. 文档职责

| 文件 | 只写 | 不写 |
|---|---|---|
| `README.md` | 安装、开发、文档索引 | 模块签名、选型理由 |
| `docs/specs/*.md` | 当前实现范围、接口契约、验收 | 模块内部细节、决策理由 |
| `docs/DECISIONS.md` | 决策编号、状态、依据 | 字段表、实现细节 |
| `docs/ARCHITECTURE.md` | 模块划分、依赖方向、目录 / 测试 / 文档约定 | 模块签名与字段 |
| `docs/modules/*.md` | 该模块的 API、契约与取舍 | 其它模块的内容 |
| `docs/GLOSSARY.md` | 本扩展特有术语的唯一命名来源 | 实现细节 |
| `docs/todos/*.md` | 任务台账、验收证据 | 契约与理由 |
| `docs/audit/*.md` | 只读审计结论 | 契约与理由 |
| `docs/research/*.md` | 外部实测与参考记录 | 当前契约 |
| `docs/配置与工具面.md` | v1 对外配置、工具 schema、提示词契约 | 决策理由 |

内容归属冲突时以本表裁决；跨文档只允许指针，不允许复述。

## 5. 约束

- M0 不写自建 registry；run root/brief 是临时目录，不承担恢复。
- M0 通过 `pi -e` 加载，不全局安装；全局安装、marker、恢复属于 M3。
- 任务状态只在 `docs/todos/`；架构与模块文档不写进度。
