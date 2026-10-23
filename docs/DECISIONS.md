# 决策

v1 目标。M0 只做最小闭环，范围以 `docs/specs/0001-m0-minimal-subagent.md` 为准；配置、工具与提示词见 `docs/配置与工具面.md`，实测见 `docs/research/herdr-恢复与状态实测.md`，参考项目取舍见 `docs/research/子代理实现对比.md`。

一句话：子进程 + pane，只做 herdr，模型面只有 run / send，结果异步回投，状态、恢复、通知交给 herdr。

参考路线：durable 的幂等与所有权、fyang93 的 profile/inbox、purboo 的 journal/fork；官方 example 只作一次性进程的反例。

## 形态与安装

| # | 决策 | 依据 |
|---|---|---|
| D1 | 自研新扩展，不改造、不 fork 参考项目 | 参考项目模块化不足 |
| D2 | 独立 repo，TypeScript + pnpm | 用户选择 |
| D3 | 子代理是子进程，不是同进程 conversation | 跨进程隔离；pane 可人工接管 |
| D6 | 用常驻子进程 `pi --session <file>`，不用一次性 `-p --no-session` | 续聊、反问、steer、herdr 恢复都要求 session |
| D12 | 语义基准是 pi-durable | 用户指定；借鉴幂等与所有权，不搬 daemon |
| D17 | all in herdr；只留 herdr 适配层和 mock seam，不做可插拔后端 | 没有第二个实现，契约就是负债（YAGNI） |
| D18 | v1 只做 herdr；headless 后端与 RPC 转发不做 | RPC 路径不保真 |
| D41 | 包名 `pi-herdr-subagents-lite`；先 git 安装，稳定后再发 npm | 用户选择；npm 名发布前确认 |

## 宿主与布局

| # | 决策 | 依据 |
|---|---|---|
| D22 | 同 workspace 开新 tab；cwd 不同则新 workspace；禁止 split 父 pane | split 会让父 TUI reflow |
| D23 | 启动链全原生：`tab create --no-focus` → `agent start NAME --kind pi --pane` → 首条任务走 argv（`@brief.md`）；不传 `--approve`，trust 由 `agent_not_ready` 暴露给人 | 复用 herdr 的就绪确认 |
| D28 | 完成默认 release + close；关闭前先读结果；只有 tab 只剩该 pane 才 `tab close`。keep 不 release。父会话 /new、/resume、/fork 或干净退出时关闭旧子代理；父进程崩溃不关，留给 herdr 恢复后按 D38 认领 | 不关会僵尸复活 |
| D32 | died 判定以 herdr 事件为主（`pane.exited`、`pane_agent_detected`、`pane.agent_status_changed`），name 消失或 `agent explain` 兜底；`agent wait` 只作兜底 | 不造每子代理等待进程 |

## 上下文与任务

| # | 决策 | 依据 |
|---|---|---|
| D13 | 默认 fresh；调用可填 fork；调用覆盖 profile 的 session-mode | 对应 purboo 的 fresh / fork |
| D9 | 任务简报写文件，用 @artifact 引用投递 | argv 只承载路径，避开转义 |
| D10 | 子代理 cwd 由 profile 指定，不跟随父会话 | 子进程按目录拾取 .pi、AGENTS.md、skills |
| D39 | fork 复制父会话 active branch 到发起 spawn 的 assistant 消息之前：含触发它的 user 消息，不含 spawn toolCall 及其结果；不用 `pi --fork` | 复制到截点才能命中前缀；--fork 会带上 spawn 本身 |
| D43 | fork 的 system、tools、model、thinking、cwd 必须与父会话截点逐字节一致；profile 显式覆盖这些字段返回 `fork_profile_incompatible`；profile body 只进任务简报；`subagent` 用同 schema/description 的 stub 保持 tool block；子扩展在 `before_agent_start` 校验，失败 `fork_prefix_mismatch` 退出 | 用户要求前缀缓存完全一致；D14 禁止嵌套 |

## 交付与结果

| # | 决策 | 依据 |
|---|---|---|
| D20 | 每次回投带 `state: done\|unknown`；相近完成在 500ms 窗口聚合；Esc 在父 pane 只取消父 turn，停子代理靠聚焦其 pane 按 Esc 或关 tab | 避免误读与通知风暴 |
| D30 | 只做异步交付，没有同步模式，也没有 wait action。`run` 立即返回 `{state:"running", name, paneId}`；结果消息开启新 turn | 异步消息是唯一结果通道；去掉 wait 后天然只上报一次 |
| D31 | herdr server 重启按 `agent_session_path` 重启；恢复命令只跑 `pi --session`，启动时额外 argv（含 `-e`）会丢。子代理崩溃默认 notify；`onAgentExit: restart` 仅在尾部没有悬空 toolCall 时同 pane 同名重启。`send` 需要重启时同样检查，悬空返回 `tail_dirty`；不按工具名特判 | 实测：-e 丢失；悬空 toolCall 会变成 No result provided，模型可能重试副作用 |
| D35 | 父子角色由同一个全局包按 `<childSession>.subagent.json` 区分：marker 在 `agent start` 前写好，存在 → 子角色（inbox 轮询、blocked emit；普通子角色不注册 `subagent`，fork 子角色注册 stub）；不存在 → 父角色。marker 同时是 loadout 快照。不依赖 `-e`、环境变量或 argv | 恢复只跑 `pi --session`；-e 实测被丢弃 |
| D36 | 结果只有一条路径：`pane.agent_status_changed` → `agent get` 读 `completion_seq` → 读子 session 最后一条 assistant 文本 → 按 `(name, completion_seq)` 去重 → 500ms 聚合 → `pi.sendMessage`。超过 16384 字符写 `<childSession>.result-<seq>.md`，消息只带头部与路径；父会话重启扫描 transcript 补投；读不到重试 3 次，仍失败保留 pane 并通知 | 用 herdr 原生事件与 completion_seq 做幂等 |

## 身份与恢复

| # | 决策 | 依据 |
|---|---|---|
| D21 | 身份 = herdr live agent name；自动 `worker-N`，可显式命名且必须唯一；同一父会话内不复用；标题只做展示 | herdr name 规则与 live 唯一性 |
| D14 | 禁止嵌套 spawn | 与 pi-durable 一致；D35 让普通子代理根本没有 `subagent` 工具 |
| D33 | `pane.report_metadata` 的 title / tokens 只做实时展示，不承担恢复身份；server 重启后会丢，认领后按 marker 重报 | 实测：重启后 title/tokens 消失 |
| D38 | 身份恢复 = live name + pane label `subagent:<parent8>` + 父 transcript 的 run 记录；父扩展 `session_start` 对三者求交集，marker 的 parentSessionId 必须等于当前父会话；不写 registry | 实测 name 与 label 保留；D33 |

## 状态与交互

| # | 决策 | 依据 |
|---|---|---|
| D24 | 状态只读 herdr：`agent list/get` 的 status、`completion_seq`、`state_change_seq`、`revision`；已读/未读用 herdr seen state | completion_seq 与谁看过无关 |
| D25 | 提醒走原生：侧边栏状态 + `notification show --sound request`；v1 不做父 pane widget | 侧边栏已显示状态 |
| D29b | 父侧 `events.subscribe` 只服务结果投递与通知；人用 `focus_agent` / `previous_agent` 跳过去，`last_pane` 跳回来；不自造快捷键、不抢焦点 | pi 快捷键只在父 pane 有焦点时生效 |

## 反问

| # | 决策 | 依据 |
|---|---|---|
| D19 | 反问不自造通道：子代理用它自己的原生 `ask_user_question`，对话框在子 pane，人直接回答；扩展不注册 ask、不做 RPC 转发，父模型不参与 | pane 内是满保真 TUI |
| D40 | pi 的 herdr 集成走生命周期钩子，ask 弹窗不会自动变 blocked；子扩展在 `tool_call` / `tool_result` 的 `ask_user_question` 上 emit `herdr:blocked`（`{active,label}`；仅当 profile 有该工具）；嵌套在 codemode 里也触发。其他阻塞 UI 不覆盖，靠 `agent explain` / `agent_not_ready` 兜底 | 实测：弹窗时仍 working；没有 emit 方 |

## 投递与写冲突

| # | 决策 | 依据 |
|---|---|---|
| D26 | 内核投递走文件 inbox：`<childSession>.inbox/`，子扩展 250ms 轮询，处理前 rename 到 `.delivered/`；working 时 steer，idle 时作为新 turn 的 user message；`agent prompt` 只作人工插话 | `agent prompt` 是键盘级通道，会与人的草稿混合 |
| D27 | 写冲突三层：并行只读、写入串行、profile 的 `writeScope` / `denyWrites`；不做 worktree | worktree 不解决依赖重装 |

## 工具与配置

| # | 决策 | 依据 |
|---|---|---|
| D11 | 高可配置：工具开关/改名、提示词覆盖、onAgentExit、并发、结果上限、聚合、关闭延迟 | 参照 pi-web-search-lite 的单一 JSON |
| D34 | 模型面只有一个工具，两个 action：`run`（agent、task、context、name?）和 `send`（name、message）。没有 wait / list / status / cancel / answer。profile 列表写进 guidelines；未知 agent 的报错回列表；超并发列 live 名称 | 用户选择；list/status/cancel/answer 有原生替代 |
| D37 | 配置只有全局一份 `<agent-dir>/pi-herdr-subagents-lite/config.json`：严格 JSON，缺失走默认，类型/枚举/未知键启动失败，数值越界 clamp；改配置重启。默认值见配置文档 | 用户选择只全局；D11 |
| D42 | profile 复用 `~/.pi/agent/agents/*.md`（全局只读，v1 不扫项目）：字段沿用 fyang93；session-mode 的 standalone / lineage-only 映射 fresh，fork 映射 fork；skills 解析为 `<agent-dir>/skills/<name>`；model / thinking / cwd 省略继承父；subagent_agents / auto-exit / interactive 接受但忽略；未知字段忽略 | 复用现成 profile；D14/D28 |

## 未决（v1，不阻塞 M0）

| # | 问题 | 处理 |
|---|---|---|
| V1 | `agent start` 带 `brief.md` 返回瞬间是否已开始首轮 | 用 `agent prompt --wait` 补确认；失败则改启动后写 inbox |
| V2 | `send` 到 blocked 子代理时 inbox 排队还是丢弃 | 排队；丢弃则返回 blocked |
| V3 | 非 ask 的阻塞 UI（trust/auth/permission）能否被 `agent explain` 识别 | 识别不了就 `agent_not_ready` + 人工 |
| V4 | 状态事件到达 done 时子 session 是否已落盘 | 读不到重试 3 次；仍失败保留 pane 并通知 |
| V5 | Windows 上 inbox 用轮询还是 fs.watch | 倾向轮询 |
| V6 | 结果 artifact 清理 | v1 不清理 |
| V7 | server 重启时 pending ask 对话框是否重绘 | 子扩展 `session_start` 检查悬空 ask 并 emit blocked；活着用 send 注入答案；死了 `tail_dirty` |

## 编号

作废：D4 → D17；D5 → D18；D7 → D30；D8 → D31；D15 → D16 → D24；D29 → D32。D30 原 wait 条款由 D34 取代；D33 原 token 认领条款由 D38 取代。

已取消：交互白名单、子代理间提问队列、同步交付、headless 与 RPC 转发、自建 registry 与 sidecar 状态机、父 pane widget；模型面不提供 wait / list / status / cancel / answer。