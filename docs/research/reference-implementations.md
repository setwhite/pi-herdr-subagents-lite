
# 参考实现

调研日期 2026-10-22；本地 pi 1.4.0、herdr 0.9.5。本文只记外部实现的可借鉴机制和要避开的做法；当前契约见 [v1 契约](../specs/0001-v1-contract.md)，决策见 [决策](../decisions/README.md)。

## 结论

1. **pi-durable 的子代理是 conversation，不是进程。** 子代理由 task 拥有，在同一 Harness 进程内运行，有自己的 transcript、model、tools、extensions（`packages/durable/README.md:640-680`）。这和 herdr 版「独立 pi 进程 + pane」是两种形态。
2. **durable 的可靠性来自「提交先于可见」+ requestId 幂等。** 崩溃重跑用 `scanConversations({ ownerTaskId })` 找回 child（`test/examples/22-subagent-foreground.ts:52-57`）；`requestId: subagent:<taskId>` 让重复提交返回同一次提交。
3. **herdr 参考实现把子代理做成 pane 里的独立 pi 进程。** 可借鉴的是 profile 字段形状、文件 inbox、读子 session 最后一条 assistant；要避开的是父模型中转反问、registry/sidecar 状态机、依赖 `-e` 注入。
4. **pane 的唯一不可替代价值是人工接管。** 跨进程隔离和 pane 可视化是保留它的理由；其余能力 durable 用进程内模型也能表达。

## pi-durable

### 前台与后台

| 维度 | 前台（22） | 后台（23） |
|---|---|---|
| 子代理实体 | child conversation，owner = tool task | child conversation，owner = anchor task |
| 完成信号 | `submission.wait()` 的 settlement | reporter task 的 `wait()` |
| 结果去向 | tool 返回值 | 作为 follow-up input 进入 parent |
| 崩溃重跑 | `replay: "safe"` + `scanConversations` | `requestId` 幂等，anchor/reporter 随扩展重新安装后继续 |
| 模型/工具继承 | child 复制 parent 的 agent（model/thinking/cwd/extensions/tools） | 同左，再 `configure` 移除 subagent 扩展、注入 identity |
| 中止 | abort tool → 级联 abort child | `conversation.abort()` 只停当前工作，子代理仍可复用 |

### 能力边界

- 子代理不能再派子代理：spawn 时 `extensions: { remove: [SubagentTools] }`（23:196-200）。
- steer vs follow-up 由投递参数决定：`whenBusy: "steer" | "followUp"`（23:88-90）。
- name → conversation 映射存在 conversation 级 document，`fork: "initial"`（23:45-58）。
- 每个 reporter 的答案只上报一次：`Subagents.reported` 记录已上报的 EntryId（23:102-120）。
- durable 跑不进 pi CLI 扩展：packages/coding-agent/src 没有 durable 引用；本地 pi 包不含 @earendil-works/pi-durable；ExtensionContext.modelRegistry 是 coding-agent 的 ModelRegistry（core/extensions/types.ts:337），不是 Harness.open 需要的 pi-ai Models。

## pi-herdr-subagents

同名参考项目有两个独立 repo，不是 fork 关系：

- fyang93 版：v1.1.0，`pi-extension/subagents/` 布局，`pi.extensions` 指向 `./pi-extension/subagents/index.ts`。
- modem-dev 版：v0.1.0，`herdr-plugin/` + `src/` 布局。

### fyang93 版

- spawn：先 `pane split --no-focus --cwd --env K=V` 或 `tab create --no-focus --label --cwd --env K=V`，再 `agent start <name> --kind pi --pane <surface> --timeout 60000 -- <args>`（`herdr.ts:149`）。identity 用 `<session>.identity.md` 文件传，避免 herdr 拒绝含换行的 agent 参数。
- 子进程启动：`pi --session <sessionFile> -e pi-extension/subagents/index.ts ...`；同时 `-e` 加载 herdr 的 pi 集成（`index.ts:759`、`integrationArgs` `index.ts:581-590`）。
- 身份：建 pane 时用 `--env` 注入 `PI_SUBAGENT_NAME`、`PI_SUBAGENT_SESSION`、`PI_SUBAGENT_AGENT`、`PI_SUBAGENT_ALLOWED`、`PI_SUBAGENT_AUTO_EXIT`、`PI_SUBAGENT_SKILLS`。
- 恢复：裸 `--session` 会丢身份与工具限制，所以每次 spawn 写 `<sessionFile>.loadout.json`，记录 tools allowlist、可 spawn 的 agent 列表、cwd、配置目录、interactive 标志；resume 时重放。
- 文件协议：send 写 `<session>.inbox/`（临时文件 + rename 原子发布、250ms 轮询、`pi.sendUserMessage(message, {deliverAs:"steer"})` 后删除）；提问写 `<session>.ask/`，父模型转达答案；完成/中断靠 `.exit`、`.exiting`、`.paused` sidecar。
- 完成判定：per-subagent watcher 依据 `<sessionFile>.exit`（`{"type":"done"}` 或 `{"type":"ping","name","message"}`）与 `<sessionFile>.exitcode`（`"<code> <runId>"`，runId 用于判定 sidecar 归属）；叠加 `pane.exited` / `pane.closed` 与 fs.watch + 慢轮询兜底；不拿 pane 文本做生命周期判定。
- blocked：父侧轮询 herdr 状态，状态为 blocked 且非 interactive 时给父模型发 `subagent_status` 消息；没有用 `herdr:blocked` 事件。

参考 profile 字段（只记参考实现的行为）：

| 字段 | 参考实现 |
|---|---|
| name / description | name 默认文件名；description 只给列表 |
| model / thinking | 显式传子进程；省略继承父 |
| tools | 纯名字 allowlist；`+` / `-` 在默认集增删；两者不能混用 |
| subagent_agents | 非空才授予 spawn 工具，并限制可 spawn 的 profile |
| skills | 逗号分隔；首次任务一起展开；找不到静默跳过 |
| session-mode | standalone / lineage-only / fork |
| system-prompt | append / replace / 省略（body 拼到 task 前） |
| auto-exit | 结束自动退出并写 .exit |
| interactive | 只抑制 blocked 通知，不决定退出 |
| cwd | 默认父 cwd；相对 config dir 解析 |
| disable-model-invocation | 从列表隐藏，显式调用仍可用 |

### modem-dev 版

- 不用 herdr `agent start`，用 herdr plugin pane：`herdr-plugin/herdr-plugin.toml` 声明 `subagent` / `argv` 两个 entrypoint，命令统一为 `bash -c 'exec bash "$HERDR_PLUGIN_ROOT/dispatch.sh"'`；`dispatch.sh` 读 `PI_HERDR_LAUNCH_SCRIPT` 并 exec。
- spawn：`herdr plugin pane open --plugin pi-herdr-subagents --entrypoint subagent --placement split [--target-pane <id>] --direction right --cwd <cwd> --env PI_HERDR_LAUNCH_SCRIPT=<script> --no-focus`；从 `plugin_pane.pane.pane_id` 取 pane id。
- 每次 spawn 生成 bash wrapper：`trap '' TSTP`、只导出精选环境变量（PATH / PI_CODING_AGENT_DIR / PI_SUBAGENT_*）、cd 到 cwd、有 .envrc 时前置 `direnv exec`；退出后把 `"$code $PI_SUBAGENT_ID"` 写进 `<sessionFile>.exitcode`；启动即崩溃时按 `PI_HERDR_HOLD_OPEN_SECS`（默认 15s）挂住 pane。
- 子进程仍显式 `-e` 加载子侧扩展；resume 重新生成启动脚本，所以手工 resume 不丢 `-e`。
- 完成判定：watcher 依据 `.exit` / `.exitcode`，叠加 `pane.exited` / `pane.closed` 与 fs.watch + 慢轮询；失败后才读 pane 尾部取诊断，不用屏幕文本做生命周期判定。
- README 的设计理由：argv 直启 plugin pane 从构造上消除了「往交互 shell 里打字」的启动竞态；herdr socket 事件让子进程死亡在毫秒级可观测。

## 官方 example

- `pi --mode json -p --no-session`，tool 解析 stdout JSON 流并等到退出（`index.ts:298,344-420,709`）。
- 无 session、无恢复、无 steer、无反问。
- 支持 single / parallel（并发上限 4）/ chain（`{previous}` 占位）。

## 采用与避开

采用：

- profile 的字段形状和 frontmatter 解析；当前字段契约见 [v1 契约](../specs/0001-v1-contract.md) 第 2 节。
- 后续消息用文件 inbox + 原子 rename + 轮询（D26）。
- 子 session 最后一条 assistant 文本作为结果（D36）。
- durable 的 requestId 幂等、所有权与「只上报一次」思路；当前用 `(name, completion_seq)` 和每 run 单次投递实现（D36）。

避开：

- 父模型中转反问；反问留在子 pane（D19）。
- 自建 registry、sidecar 状态机、用 `.exit` 做生命周期判定；死亡看 herdr 状态，`.exit` 只补原因（D31/D32/D46）。
- 依赖 `-e` 注入子侧扩展；herdr server 重启会丢启动 argv（D31/D46）。
- 拿 pane 文本做生命周期判定；只在失败后读尾部诊断（D32）。
- 进程内 conversation；子代理必须是独立进程，pane 才能人工接管（D3）。
