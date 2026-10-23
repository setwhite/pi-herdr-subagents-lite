# pi-herdr-subagents 参考实现

基准：pi-herdr-subagents 1.1.0（现装的是 fyang93 fork）。本文只记可借鉴的机制和要避开的做法；代码见 `_repos/fyang93-pi-herdr-subagents`，本项目契约见 `docs/配置与工具面.md`，理由见 `docs/DECISIONS.md`。

## 流程

1. 每次 run/list 重新扫描 profile：全局 `~/.pi/agent/agents/*.md`，项目 `<cwd>/.pi/agents/*.md`；项目覆盖同名全局。本项目 v1 只读全局（D42）。
2. 为每次 spawn 建 child session 和 loadout 快照（agent、tools、system prompt、cwd、可 spawn 列表）。快照用于恢复，避免 profile 后来被改。本项目用 `<childSession>.subagent.json` 承担同一职责（D35）。
3. 启动 `pi --session <child> -e subagent-done.ts ...`，按 profile 生成 model/thinking/tools/skill/system prompt，并用环境变量 `PI_SUBAGENT_*` 传子侧配置。本项目不依赖 `-e` 或环境变量（D31/D35）。
4. 任务写 `<childSession>.inbox/`，子进程每 250ms 轮询并注入。本项目首条任务走 argv brief（D23），后续 send 才用 inbox（D26）。
5. 反问走父进程中转：子进程写 `.ask/`，父扩展发 `subagent_question` 给父模型，父模型再 `subagent_message` 回答。本项目不采用；反问留在子 pane（D19）。
6. 子进程 `auto-exit` 结束后写 `.exit` sidecar，父扩展读 summary，用 `pi.sendMessage(... triggerTurn)` 回投。本项目改用 herdr 状态/事件 + 子 session 读取（D30/D36）。

## profile 字段

| 字段 | 参考实现 | 本项目 v1 |
|---|---|---|
| name / description | name 默认文件名；description 只给列表 | 同；name 映射 herdr name |
| model / thinking | 显式传子进程；省略继承父 | 同 |
| tools | 纯名字 allowlist；+/- 在默认集增删；两者不能混用 | 同；`ask_user_question` 不自动加入；`subagent` 从普通子角色剔除 |
| subagent_agents | 非空才授予 spawn 工具，并限制可 spawn 的 profile | 接受但忽略；禁止嵌套（D14） |
| skills | 逗号分隔；首次任务一起展开；找不到静默跳过 | 同；解析 `<agent-dir>/skills/<name>` |
| session-mode | standalone / lineage-only / fork | standalone / lineage-only → fresh；fork → fork（D42） |
| system-prompt | append / replace / 省略（body 拼到 task 前） | 同 |
| auto-exit | 结束自动退出并写 .exit | 忽略；关闭统一由 D28 负责 |
| interactive | 只抑制 blocked 通知，不决定退出 | 忽略 |
| cwd | 默认父 cwd；相对 config dir 解析 | 默认继承父；相对父 cwd 解析 |
| disable-model-invocation | 从列表隐藏，显式调用仍可用 | 同 |

参考实现的关键细节：

- `tools` 纯名字和 `+/-` 不能混用，否则 spawn 报错。
- 参考实现自动加入 `ask_question` 和（在 `subagent_agents` 非空时）spawn 工具；本项目不自动加入 ask，也不开嵌套。
- 参考实现的 `session-mode: fork` 只复制 active branch，但 system/tools 与父不同，不能保证 prefix cache。本项目额外做 prefix lock（D43）。
- 参考实现用 registry + loadout 做恢复；本项目用 marker + live name + pane label + transcript（D35/D38）。

## 采用与避开

采用：

- profile 的字段形状和 frontmatter 解析。
- loadout/marker 快照本身，不复用 registry。
- 后续消息用 inbox 文件 + 250ms 轮询 + `.delivered/` 防重复。
- 子 session 最后一条 assistant 文本作为结果。

避开：

- 父模型中转反问；改用子 pane 原生 `ask_user_question`。
- 自建 registry、sidecar 状态机和 `.exit` 分类；改用 herdr 状态/事件。
- 依赖 `-e` 注入子侧扩展；恢复会丢。
- 自动加后缀解决重名；identity 依赖 herdr name。
- 项目级 profile 覆盖（v1 配置只全局）。

## 结论

可复用的是 profile 与 session/loadout 的形状、inbox 投递和结果读取；不可复用的是把反问、恢复、状态机都塞进父扩展和 sidecar 的做法。本项目把宿主能力交给 herdr，把内核缩到 run/send 和一条结果路径。