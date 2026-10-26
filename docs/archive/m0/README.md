
# M0 归档

M0 于 2026-10-23 完成：一个 `subagent` 工具、只有 `run`、固定 worker、fresh context、异步结果、4 个并发槽、1s 轮询、无配置。当前代码见 [ARCHITECTURE](../../ARCHITECTURE.md)；v1 契约见 [v1 契约](../../specs/0001-v1-contract.md)，决策见 [决策](../../decisions/README.md)。本文是历史快照，不再更新。

- 设计/验收快照：[spec.md](spec.md)
- E2E 记录：[e2e-logs.md](e2e-logs.md)
- 当前手工 runbook：[e2e/herdr.md](../../e2e/herdr.md)

## 任务与审计

| 任务 | 交付物 | 结论 | 审计指出的关键问题 |
|---|---|---|---|
| T01 | 最小 package、唯一工具 schema、`not_in_herdr` | pass | 入口缺 default export；测试用类型断言模拟 ToolDefinition |
| T02 | `run` 起 worker、tab、4 槽、`max_concurrent` | pass | `name_taken` 只重试 3 次而非 4 次；重试后 label 未更新；`active()` 重复且无调用点；服务在注册回调而非 `session_start` 创建 |
| T03 | 1s 轮询、完成回投、关 tab、释放槽 | pass | `service ?? startService()` 兜底无覆盖；完成路径重复 release；读结果只读一次不重试；轮询错误被吞；测试重复 |
| T04 | 启动失败 `spawn_failed`、`name_taken` 重试 | pass | 启动 catch 里的 ToolError 分支无人抛出；失败路径重复 splice；失败用例漏登记临时目录 |
| T05 | `unknown`、连续轮询失败、结果读取失败、shutdown | pass | 无 |
| T06 | 长结果截断、close kept/抛错仍投递 | pass | 无 |
| T07 | 真实 HerdrHost、正常 E2E、反问留在子 pane | pass | `readLastAssistantText` 已无生产调用点；E2E 命令有未赋值变量/省略路径 |
| T08 | 真实并发、子进程被杀、父 `/new`、清理 | pass | 父启动命令有占位符与未定义 `parent2`；隔离环境已删除，记录无法直接复跑 |

审计的完整原文未保留；上表保留结论与可行动的问题。T07/T08 的手工 E2E 当时由用户明确豁免，记录按已接受处理。

## 关键事实

- 启动链必须分两步：`agent start` 到 idle，再 `agent prompt @brief`；brief 放进启动 argv 会让长任务在 30s 后 `spawn_failed`。
- ask 弹窗期间 herdr 可能报 `agent_status=done` + `completion_seq>0`；最后一条 assistant 仍带 toolCall 时要继续轮询。
- 子代理被杀死后 session 尾部可能留悬空 toolCall；重启前必须检查，否则模型看到 No result provided 后可能重试副作用。
- 父 `/new` 后旧 worker 不被认领、不再投递；旧 tab 留人工清理。
