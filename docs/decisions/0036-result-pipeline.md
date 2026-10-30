# 0036 结果投递路径

结果路径：`agent list` 快照 → `completion_seq` 大于该 run 的 `lastHandledSeq` 且状态为 `idle` / `done` → 读子 session 尾部 → 写 `lastHandledSeq` → 聚合窗口 → 回投父会话。超过 `maxResultChars` 写 artifact，消息只带头部与路径；读不到结果重试有限次，仍失败保留 pane 并通知。

依据：一次快照覆盖所有 run；`completion_seq` 与谁看过无关；不重启就没有同名复用，单一游标够用。
