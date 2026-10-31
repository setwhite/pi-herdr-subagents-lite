# run

run 生命周期内核。对外行为见 [v1 契约](../specs/0001-v1-contract.md)；本文只写取舍。

## 状态来源

- 每一拍拉一次 `agent list` 快照，按 `paneId`、再按 `name` 定位 run，比较 `completion_seq`（DEC-0052）。不订阅 herdr 事件：一次调用覆盖所有 run，不需要 socket 与重连，server 重启后下一拍自动对账。
- 只有对账，没有事件边沿：快照与 `completion_seq` 单调比较是幂等的，丢一拍下一拍补上。所以间隔只是延迟预算，正确性不依赖它。
- 两档间隔，由同一拍的结果决定：有 run 在 working / blocked / unknown，或最近 30 秒内 `run` / `send` 过，用 `pollIntervalMs`；所有 live run 都只是收工等 `send`，用 `idlePollIntervalMs`。`run` / `send` 会把下一拍拉回活跃档。
- 读重试也不单独计时：记 `run.read.at`，下一拍取最早的到期时间，全进程只有一个 `setTimeout`。
- 单次 `agent list` 失败不算死亡；连续 3 拍失败才结算 `poll_failed`。
- `completion_seq` 大于 `lastHandledSeq` 且状态是 `idle` / `done` 时才读子 session 尾部。

## 槽位

- run 在第一次 await 之前占槽，并发 `run()` 立刻看到它。
- `done` 且 `auto-exit: false` 的 run 仍为 live、仍占槽，`send` 才能续聊（DEC-0047）。父侧因此一直轮询，这类 run 是慢速档。
- `send` 受同一上限约束：已收工或已退出的 run 重新变成 live 之前要占槽；已满时返回 `max_concurrent`，不投递、不重启。

## send

- 只有显式 `send` 才重启，死亡不自动重启（DEC-0031）。
- 重启重读 profile，不用快照；非 `task` 模式按新 profile 重写身份文件。
- auto-exit 走 pane env（DEC-0056）。新 profile 的 `auto-exit` 与建 tab 时的值不一致时，关掉旧 tab（只在它只剩该 pane 时）并新建 tab；否则原地 resume。
- 子 session 存在但读不了报 `session_unreadable`；不存在报 `session_missing`；尾部有未完成 toolCall 报 `tail_dirty`。

## 结果与关闭

- 结果超过 `maxResultChars` 时落 artifact；写失败仍按 `done` 投递并附警告（DEC-0036）。
- 聚合窗口 0 与非 0 的投递失败都走 `onError` → 父会话收到 `subagent result not delivered`。0 不排队，直接投递。
- `shutdown` / `closeChildren` 置 stopped，等在途 `start()` 结束；在途 start 被取消，已建的 pane 一并关掉。
- `closeChildren` 先把所有 run 结算为 expected，再并发关 tab，所以不会投 `pane_exited`。返回 `kept`（tab 有多个 pane）与 `failed`（关 tab 失败），通知由 [extension](extension.md) 发（DEC-0048）。
