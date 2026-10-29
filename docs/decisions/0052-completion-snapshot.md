# 0052 完成检测用 agent list 快照

父侧每 `pollIntervalMs` 调一次 `herdr agent list`，读取所有 agent 的 `agent_status` 与 `completion_seq`，按 run 的 `pane_id` 定位（`agent rename` 后不变），`name` 兜底；`completion_seq` 变化且状态为 `idle` 或 `done` 时读子 session 尾部。每个 run 只记 `lastHandledSeq`。不订阅 herdr 事件，不维护状态机；以后若改用事件，`events.subscribe` 只服务结果投递与通知。

依据：一次调用覆盖所有 run；不需要 socket 与重连；`pane_id` 由 `agent list` 自带；herdr server 重启后下一拍自动对账。
