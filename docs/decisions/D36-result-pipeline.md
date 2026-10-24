# D36 结果投递路径

结果路径：herdr 状态事件 → `completion_seq` → 读子 session 尾部 → 按 `(name, completion_seq)` 去重 → 500ms 聚合 → 回投父会话。超过 16384 字符写 artifact，消息只带头部与路径；读不到重试 3 次，仍失败保留 pane 并通知。

依据：用 herdr 原生事件与 `completion_seq` 做幂等。
