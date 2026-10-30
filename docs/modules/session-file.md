# session-file

`readLastAssistant` 返回最后一条 assistant 的 `{ text, pendingToolCall, empty }`；文件读不到、坏行、没有文本时 text 为 null，还没有 assistant 消息时 empty 为真，不重试、不 sleep。

`writeExitReceipt` 写 `<sessionFile>.exit` 的 `{ reason }`；`readExitReceipt` 读回执，缺失或坏 JSON 返回 null。
