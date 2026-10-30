# session-file

`readLastAssistant` 返回最后一条 assistant 的 `{ text, pendingToolCall, empty }`；文件读不到、或没有任何 assistant 消息时 text 为 null、empty 为真；坏行跳过；最后一条 assistant 没有文本时 text 为 null、empty 为假。不重试、不 sleep。

`writeExitReceipt` 写 `<sessionFile>.exit` 的 `{ reason }`；`readExitReceipt` 读回执，缺失、坏 JSON 或结构不对返回 null。
