# session-file

读子 session 与退出回执。本文只写取舍。

## 读尾部

- `readLastAssistant` 返回 `{ text, pendingToolCall, empty, unreadable }`。
- `unreadable`（文件缺失、权限、目录）与 `empty`（还没有 assistant 消息）是两回事：轮询把 `empty` 当「继续等」，把 `unreadable` 读 3 次后结算 `no_result`；`send` 对 `unreadable` 返回 `session_unreadable`，不重启。
- 读错误不吞：只有解析失败的行跳过，读文件失败返回 `unreadable`。
- session 文件大于尾部窗口时先读窗口，窗口里没有 assistant 消息再读全文。取舍：轮询路径避免每次读整份 JSONL，正确性靠全文回退保底。
- 最后一条 assistant 没有文本时 `text: null`、`empty: false`；有 `toolCall` 才算 `pendingToolCall`。

## 退出回执

- `<childSession>.exit` 只有 `{ reason }`。缺失、坏 JSON、结构不对都返回 null：坏回执当作缺失，不猜原因。
- 其它读错误（如 EACCES）上抛，不当作缺失：真实的 I/O 问题不能被说成「没走过 shutdown」。
