# D52 完成检测用 agent list 快照

父侧每 1s 调一次 `herdr agent list`，读取所有 agent 的 `agent_status` 与 `completion_seq`，按 run 的 `name` 过滤；`completion_seq` 变化且状态为 `idle` 或 `done` 时读子 session 尾部。每个 run 只记 `lastHandledSeq`。不订阅 herdr 事件，不维护状态机。

依据：一次调用覆盖所有 run；不需要 socket、重连和 pane_id 映射；herdr server 重启后下一拍自动对账。
