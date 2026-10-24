# 决策

v1 设计：子代理是 herdr pane 里的常驻 pi 子进程；模型面只有 `run` / `send`；结果异步回投；fresh only。当前 M0 代码见 [ARCHITECTURE](../ARCHITECTURE.md)。

一条决策一份文件，文件名前缀就是 ID（`D36` → [D36-result-pipeline.md](D36-result-pipeline.md)）。v1 契约见 [v1 契约](../specs/0001-v1-contract.md)；已取消的提案见 [cancelled.md](cancelled.md)。

## 形态

| # | 决策 |
|---|---|
| [D1](D1-own-extension.md) | 自研扩展，不 fork 参考项目 |
| [D2](D2-repo-and-stack.md) | 独立 repo 与技术栈 |
| [D3](D3-subprocess.md) | 子代理是独立子进程 |
| [D6](D6-persistent-session.md) | 常驻子进程用 `pi --session` |
| [D17](D17-herdr-only.md) | all in herdr |
| [D18](D18-no-headless.md) | 不做 headless 与 RPC |
| [D41](D41-package-name.md) | 包名与发布方式 |

## 布局与启动

| # | 决策 |
|---|---|
| [D22](D22-tab-placement.md) | 新 tab 或新 workspace |
| [D23](D23-start-then-prompt.md) | 先等 idle，再投 brief |
| [D28](D28-close-on-done.md) | 完成即 release 并关 tab |
| [D32](D32-death-detection.md) | died 判定以 herdr 事件为主 |

## 任务与上下文

| # | 决策 |
|---|---|
| [D9](D9-brief-file.md) | 任务简报写文件，用 `@brief` 投递 |
| [D10](D10-cwd-from-profile.md) | 子代理 cwd 由 profile 指定 |
| [D13](D13-fresh-only.md) | v1 只支持 fresh |

## 结果与恢复

| # | 决策 |
|---|---|
| [D20](D20-result-states.md) | 回投状态与聚合 |
| [D30](D30-async-only.md) | 只做异步交付 |
| [D31](D31-crash-recovery.md) | 子代理崩溃默认 notify |
| [D36](D36-result-pipeline.md) | 结果投递路径 |

## 身份与展示

| # | 决策 |
|---|---|
| [D21](D21-identity.md) | 身份 = herdr live agent name |
| [D44](D44-display.md) | 展示只用 name 与任务首行 |
| [D33](D33-no-metadata.md) | 不依赖 pane.report_metadata |
| [D38](D38-no-reclaim.md) | 父进程重启后不认领旧子代理 |

## 状态与交互

| # | 决策 |
|---|---|
| [D24](D24-state-source.md) | 状态只读 herdr |
| [D25](D25-native-alerts.md) | 提醒走原生 |
| [D29b](D29b-event-subscription.md) | 父侧事件订阅只服务投递 |
| [D19](D19-ask-in-pane.md) | 反问留在子 pane |
| [D40](D40-bridge.md) | bridge 上报 blocked |

## 投递与写冲突

| # | 决策 |
|---|---|
| [D26](D26-file-inbox.md) | send 走文件 inbox |
| [D27](D27-no-write-limits.md) | 不做运行时写限制 |

## 工具与配置

| # | 决策 |
|---|---|
| [D11](D11-config-surface.md) | 可配置项 |
| [D34](D34-single-tool.md) | 模型面只有一个工具，两个 action |
| [D37](D37-config-layers.md) | 配置全局 + 项目 |
| [D42](D42-profile-layers.md) | profile 全局 + 项目 |
| [D45](D45-tool-name.md) | 默认工具名 subagent，重名不处理 |
| [D46](D46-no-role-detection.md) | 不做父子角色检测 |

## 边界与验证

| # | 问题 |
|---|---|
| [V2](V2-send-blocked.md) | `send` 到 blocked 子代理 |
| [V4](V4-session-flush.md) | 状态事件到达 done 时子 session 是否已落盘 |
| [V6](V6-artifact-cleanup.md) | 结果 artifact 清理 |
| [V7](V7-pending-ask.md) | herdr server 重启时 pending ask 对话框是否重绘 |
