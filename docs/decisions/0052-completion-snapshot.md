# 0052 完成检测用 agent list 快照

父侧每 `pollIntervalMs` 调一次 `herdr agent list`，读取所有 agent 的 `agent_status` 与 `completion_seq`，按 run 的 `pane_id` 定位（`agent rename` 后不变），`name` 兜底；`completion_seq` 大于该 run 的 `lastHandledSeq` 且状态为 `idle` 或 `done` 时读子 session 尾部。每个 run 只记 `lastHandledSeq`。不订阅 herdr 事件，不维护状态机；以后若改用事件，`events.subscribe` 只服务结果投递与通知。

依据：一次调用覆盖所有 run；不需要 socket 与重连；`pane_id` 由 `agent list` 自带；herdr server 重启后下一拍自动对账。

## 修订：两档间隔与单一时钟

固定 `pollIntervalMs` 会让「收工但 `auto-exit: false` 因而仍占槽」的空闲 run 也按活跃档轮询，实测每次 `agent list` 31–46 ms，长时间空闲就是每秒一次进程启动。

改为按同一拍的结果选档：有 run 在 working / blocked / unknown，或最近 30 秒内 `run` / `send` 过，用 `pollIntervalMs`；所有 live run 都只是收工等 `send`，用 `idlePollIntervalMs`（默认 8000）。代价是 pane 死亡的最晚发现时间从 `pollIntervalMs` 变成 `idlePollIntervalMs`，只影响 `pane_exited` 通知的时效，不影响结算正确性。

`run` / `send` 会重置活跃窗口，但不排 0 延迟的第一拍：启动瞬间 agent 可能还没进 `agent list`，会被误判成 pane 已退出。第一拍仍按 `pollIntervalMs`。

读重试改为记 `run.read.at`，由同一拍取最早到期时间，删掉每个 run 自己的定时器：一个进程只有一个 `setTimeout`，测试也只推一个时钟。

仍不订阅事件：schema 里有 `PaneAgentStatusChangedEvent` 与 `EventsSubscribeParams`，但 CLI 只暴露 `agent wait`、`pane wait-output`、`api snapshot`，没有订阅命令；自建 socket 客户端要绑 protocol 版本、重连、server reload 兜底，复杂度超过省下的进程启动。
