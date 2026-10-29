# 决策

v1 设计：子代理是 herdr pane 里的常驻 pi 子进程；模型面只有 `run` / `send`；结果异步回投；fresh only。当前代码见 [ARCHITECTURE](../ARCHITECTURE.md)。

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

## 架构

| # | 决策 |
|---|---|
| [D55](D55-architecture-naming.md) | 模块命名与文件拆分 |

## 布局与启动

| # | 决策 |
|---|---|
| [D22](D22-tab-placement.md) | 新 tab 或新 workspace |
| [D23](D23-start-then-prompt.md) | 先等 idle，再投 brief |
| [D47](D47-close-on-done-default-keep.md) | 完成默认保留 tab；关闭由 auto-exit 与 closeChildrenOn 决定 |
| [D48](D48-close-children-on.md) | 父会话结束按 closeChildrenOn 清理 |
| [D32](D32-death-detection.md) | died 判定以 agent list 消失为准 |
| [D53](D53-session-dir.md) | 子 session 放在 agent dir |
| [D56](D56-auto-exit-channel.md) | auto-exit 用 pane env 传 |

## 任务与上下文

| # | 决策 |
|---|---|
| [D9](D9-brief-file.md) | 任务简报写文件，用 `@brief` 投递 |
| [D10](D10-cwd-from-profile.md) | 子代理 cwd 默认继承父 |
| [D13](D13-fresh-only.md) | v1 只支持 fresh |
| [D50](D50-skills.md) | skills 三态 |
| [D51](D51-system-prompt.md) | system-prompt 三模式 |

## 结果与恢复

| # | 决策 |
|---|---|
| [D20](D20-result-states.md) | 回投状态与聚合 |
| [D30](D30-async-only.md) | 只做异步交付 |
| [D31](D31-crash-recovery.md) | 死亡不重启，send 可续聊 |
| [D36](D36-result-pipeline.md) | 结果投递路径 |
| [D52](D52-completion-snapshot.md) | 完成检测用 agent list 快照 |

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
| [D40](D40-bridge.md) | bridge 上报 blocked |
| [D49](D49-merge-bridge.md) | bridge 并入主扩展 |

## 投递与写冲突

| # | 决策 |
|---|---|
| [D26](D26-file-inbox.md) | send 走文件 inbox |
| [D54](D54-question-via-pane-scan.md) | 子代理提问靠父侧扫 pane |
| [D27](D27-no-write-limits.md) | 不做运行时写限制 |

## 工具与配置

| # | 决策 |
|---|---|
| [D11](D11-config-surface.md) | 可配置项 |
| [D34](D34-single-tool.md) | 模型面只有一个工具，两个 action |
| [D37](D37-config-layers.md) | 只有全局配置 |
| [D42](D42-profile-layers.md) | profile 全局 + 项目 |
| [D45](D45-tool-name.md) | 默认工具名 subagent，重名不处理 |
| [D46](D46-no-role-detection.md) | 角色只看 inbox 目录 |

