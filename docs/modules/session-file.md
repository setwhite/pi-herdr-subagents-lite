# session-file

`readLastAssistant` 返回最后一条 assistant 的 `{ text, pendingToolCall }`；文件读不到、坏行、没有文本时 text 为 null，不重试、不 sleep。

`writeExitReceipt` 写 `<sessionFile>.exit` 的 `{ reason }`；`readExitReceipt` 读回执，缺失或坏 JSON 返回 null。
