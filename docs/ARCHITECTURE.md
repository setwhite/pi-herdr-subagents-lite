# 架构

## 边界

M0 是一个最小 package，package 根就是仓库工作目录：代码在 `src/`，测试在 `test/`，文档在 `docs/`。只做 herdr；按功能分模块，不按 controller/service/adapter 分层。行为与验收见 `docs/specs/0001-m0-minimal-subagent.md`；v1 决策见 `docs/DECISIONS.md`。

入口只装配真实依赖，不持有运行态；SubagentService 由 extension 在 `session_start` 创建。

## 模块

| 模块 | 职责 | 公开接口 | 依赖 | README |
|---|---|---|---|---|
| extension | pi 工具、生命周期、消息信封、错误渲染 | createExtension(deps) | subagent；herdr/session 端口（type-only）；pi 类型 | [extension](../src/extension/README.md) |
| subagent | run 生命周期、并发、命名、轮询、结果内容/截断 | SubagentService、RunStarted、ToolError、SubagentResult | herdr 端口、session 读取、Node fs | [subagent](../src/subagent/README.md) |
| herdr | HerdrHost 端口 + CLI 适配 | HerdrHost | Node child_process | [herdr](../src/herdr/README.md) |
| session | 读 child session 最后一条 assistant 的文本与 toolCall 状态 | readLastAssistant(path) | Node fs | [session](../src/session/README.md) |

入口不是第五个模块：只构造真实 host/session 并导出扩展。

## 依赖

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

herdr、session 是叶子；subagent 不 import pi；extension 不 import 真实 CLI 或 fs；只有 index 同时认识真实适配器与 pi。

## 放置

- 功能代码在 `src/<feature>/`，模块 README 与代码同目录；测试在 `test/`；`package.json`、tsc、biome、vitest 配置在根。
- 不建 utils/common/helpers/ports 层；共享类型放拥有它的模块，跨模块只走模块入口。
- index 只做 composition root + 默认导出；extension 是唯一注册工具、使用 pi 生命周期的模块。
- 结果内容与截断属于 subagent；消息信封（customType、display、triggerTurn、头部）属于 extension。错误在 herdr 映射为 host 错误，在 subagent 映射为 ToolError，extension 只渲染。

## seam

| seam | 用法 | 覆盖 |
|---|---|---|
| pi 扩展 API + 注入 HerdrHost | fake pi、fake host、fake timers、临时 session JSONL | 工具契约、run 生命周期、并发、结果消息 |
| SessionReader | 纯函数表驱动 | JSONL 解析边界 |
| 真实 HerdrHost + pi | 手工 E2E | CLI argv/JSON、tab/agent/close、真实 child |

只有一个 mock seam。真实 CLI 不写第二个 mock；字段变化由手工 E2E 暴露。测试不 mock SubagentService 内部，也不 mock Node fs。

## 约束

- M0 不写自建 registry；run root/brief 是临时目录，不承担恢复。
- M0 通过 `pi -e` 加载，不全局安装；全局安装、marker、恢复属于 M3。
- 任务状态只在 `docs/todos/`；架构与模块文档不写进度。