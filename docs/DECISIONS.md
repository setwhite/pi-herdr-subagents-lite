
# 决策

v1 目标。当前 M0 代码见 [ARCHITECTURE](ARCHITECTURE.md)；对外契约见 [CONTRACT](CONTRACT.md)；提示词见 [PROMPTS](PROMPTS.md)；M0 历史见 [archive/m0](archive/m0/README.md)；herdr 事实见 [research](research/herdr-恢复与状态实测.md)。

一句话：子代理是 herdr pane 里的常驻 pi 子进程；模型面只有 `run` / `send`；结果异步回投；fresh only；不做 fork、marker、角色检测、写限制、父进程重启认领。

## 形态

| # | 决策 | 依据 |
|---|---|---|
| D1 | 自研扩展，不改造、不 fork 参考项目 | 参考项目模块化不足 |
| D2 | 独立 repo，TypeScript + pnpm | 用户选择 |
| D3 | 子代理是子进程，不是同进程 conversation | 跨进程隔离；pane 可人工接管 |
| D6 | 常驻子进程 `pi --session`，不用一次性 `-p --no-session` | 续聊、反问、steer、恢复都要求 session |
| D17 | all in herdr；只留适配层与 mock seam，不做可插拔后端 | 没有第二个实现，契约是负债 |
| D18 | 不做 headless 后端与 RPC 转发 | RPC 路径不保真 |
| D41 | 包名 `pi-herdr-subagents-lite`，公开发布 npm；README 标 experimental，不承诺版本兼容 | 用户选择 |

## 布局与启动

| # | 决策 | 依据 |
|---|---|---|
| D22 | 同 workspace 开新 tab；cwd 不同则新 workspace；不 split 父 pane | split 会让父 TUI reflow |
| D23 | 先开 tab，等 agent 到 idle 再投 brief；brief 不进启动参数 | 带首轮任务的 child 立刻 working，启动等待会超时 |
| D28 | 完成默认 release + close；keep 不 release；父会话切换或 shutdown 关旧子代理；父进程崩溃不关、不认领 | 不关会僵尸复活；父崩溃后无法可靠认领 |
| D32 | died 判定以 herdr 事件为主；name 消失或 `agent explain` 兜底；`agent wait` 只作兜底 | 不造每子代理等待进程 |

## 任务与上下文

| # | 决策 | 依据 |
|---|---|---|
| D9 | 任务简报写文件，用 `@brief` 投递 | argv 只承载路径，避开转义 |
| D10 | 子代理 cwd 由 profile 指定，不跟随父会话 | 子进程按目录拾取 `.pi`、`AGENTS.md`、skills |
| D13 | v1 只支持 fresh；续聊只靠 `send`；不做 fork / prefix cache | 没有真实用例证明 prefix cache 收益；复制 transcript 的复杂度不值 |

## 结果与恢复

| # | 决策 | 依据 |
|---|---|---|
| D20 | 每次回投带 `state: done / unknown`；相近完成 500ms 聚合；Esc 在父 pane 只取消父 turn，停子代理靠聚焦其 pane 按 Esc 或关 tab | 避免误读与通知风暴 |
| D30 | 只做异步交付，没有同步模式，没有 wait；`run` 立即返回 `{state:"running", name, paneId}`；结果消息开启新 turn | 异步消息是唯一结果通道 |
| D31 | 子代理崩溃默认 notify；`onAgentExit: restart` 只在尾部没有未完成 toolCall 时同 pane 同名重启一次；`send` 需要重启时同样检查，否则 `tail_dirty`。herdr server 重启用 session 路径恢复；全局安装后不依赖 `-e` | 实测：`-e` 丢失；悬空 toolCall 会变成 No result provided，模型可能重试副作用 |
| D36 | 结果路径：herdr 状态事件 → `completion_seq` → 读子 session 尾部 → 按 `(name, completion_seq)` 去重 → 500ms 聚合 → 回投父会话。超过 16384 字符写 artifact，消息只带头部与路径；读不到重试 3 次，仍失败保留 pane 并通知 | 用 herdr 原生事件与 `completion_seq` 做幂等 |

## 身份与展示

| # | 决策 | 依据 |
|---|---|---|
| D21 | 身份 = herdr live agent name；自动 `<profile>-<n>`；同一父会话内按 profile 递增；冲突时 +1 重试；不接受显式 name | herdr name 规则与 live 唯一性 |
| D44 | 展示：`name` = tab 标签 = 侧边栏；pane 头 = 任务第一行（截 32 字）；不设 `title` / `display_agent` / `state_labels`；不改 workspace label | 人只需要记一个名字；`send` 只认 name |
| D33 | 不依赖 `pane.report_metadata` 做恢复；不设 `title` / tokens；server 重启会丢；tab / pane label 保留 | 实测：重启后 metadata 消失 |
| D38 | 父进程退出/重启后不重新认领旧子代理；不扫 transcript、不写 registry；旧 tab 留给 herdr 人工处理 | 认领需要三方交集，复杂且易错 |

## 状态与交互

| # | 决策 | 依据 |
|---|---|---|
| D24 | 状态只读 herdr：`agent list/get` 的 status、`completion_seq`、`state_change_seq`、`revision` | `completion_seq` 与谁看过无关 |
| D25 | 提醒走原生：侧边栏状态 + 带请求音的通知；不做父 pane widget | 侧边栏已显示状态 |
| D29b | 父侧 `events.subscribe` 只服务结果投递与通知；人用 `focus_agent` / `previous_agent` 跳转；不自造快捷键、不抢焦点 | pi 快捷键只在父 pane 有焦点时生效 |
| D19 | 反问不自造通道：子代理用它自己的 `ask_user_question`，对话框在子 pane，人直接回答；父模型不参与 | pane 内是满保真 TUI |
| D40 | 包内第二个扩展 `bridge`：监听 pi 原生 `ui_prompt_start` / `ui_prompt_end`，emit `herdr:blocked`；`blockedOn` 可配；全局安装后父子进程都上报 | herdr 集成只监听 `herdr:blocked`；`ui_prompt_*` 覆盖所有 `ctx.ui` 对话框 |

## 投递与写冲突

| # | 决策 | 依据 |
|---|---|---|
| D26 | `send` 走文件 inbox；working 时 steer，idle 时新 turn，blocked 时排队；`agent prompt` 只作人工插话 | `agent prompt` 是键盘级通道，会与人的草稿混合 |
| D27 | 不做运行时写限制；不校验 `writeScope` / `denyWrites`；「并行只读、写入串行」只是使用建议，不强制执行 | 工具路径校验可以被脚本绕过，只是安全表演 |

## 工具与配置

| # | 决策 | 依据 |
|---|---|---|
| D11 | 可配置：工具开关/改名、提示词覆盖、`onAgentExit`、并发、结果上限、聚合、关闭延迟、bridge | 单一 JSON，默认值可用 |
| D34 | 模型面只有一个工具，两个 action：`run(profile, task)` 和 `send(name, message)`。没有 wait / list / status / cancel / answer。profile 列表写进 guidelines；未知 profile 的报错回列表；超并发列 live 名称 | 用户选择；list/status/cancel/answer 有原生替代 |
| D37 | 配置全局 + 项目；项目只在 trust 后读取；按顶层键覆盖，对象整体替换；严格 JSON，未知键/类型/枚举失败，数值越界 clamp；改完重启 | 用户选择；pi 项目配置约定 |
| D42 | profile 全局 + 项目，同名项目覆盖；文件名是 profile 名，frontmatter `name` 只作显示名；字段见 CONTRACT；未知字段忽略，解析失败跳过；不做 `session-mode` / `writeScope` / `denyWrites` | 复用现成 profile；用户选择项目级 |
| D45 | 默认工具名 `subagent`；跨扩展重名不检测、不改名、不避让 | 用户明确：冲突不用本扩展管 |
| D46 | 不做父子角色检测、marker、loadout；全局安装后子进程也加载本包；子进程是否有 `subagent` 工具由 profile 的 `tools` 决定；嵌套只靠提示词 / profile tools | 用户选择；marker 与角色检测是额外状态 |

## 取消

旧编号已删除，保留条目避免重新提议：

- fork / prefix cache
- marker / 子角色 / loadout
- 父进程重启认领
- 写冲突限制
- 强制拦截嵌套
- 工具名冲突处理
- 同步交付、wait / list / status / cancel / answer
- headless 后端、RPC 转发
- 自建 registry、sidecar 状态机、父 pane widget

## 边界与验证

| # | 问题 | 状态 |
|---|---|---|
| V2 | `send` 到 blocked 子代理 | 已定：排队；人回答后子进程继续处理 |
| V4 | 状态事件到达 done 时子 session 是否已落盘 | 待验证：读不到重试 3 次；仍失败保留 pane 并通知 |
| V6 | 结果 artifact 清理 | 已定：v1 不清理 |
| V7 | herdr server 重启时 pending ask 对话框是否重绘 | 待验证：子进程还活着则对话框还在；父侧不重放；需要时人工处理 |
