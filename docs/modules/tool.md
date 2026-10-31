# tool

模型面：两个 action、一份 schema、一份文案。本文只写取舍。

- `HERDR_ENV !== "1"` 直接返回 `not_in_herdr`：没有降级路径，父进程不在 herdr pane 里时没有 pane 可开。
- `ToolError` 渲染成 `<code>: <message>` 并置 `isError`；其它异常继续抛给 pi。工具只把已知失败变成模型能读的错误，未知失败不伪装。
- 结果走 `subagent_result` 自定义消息，`triggerTurn: true`：异步结果要能唤醒父模型，而工具结果只能在调用当轮返回（DEC-0030、DEC-0036）。
- 一批结果合成一条消息，块间空行分隔：一个聚合窗口只产生一次唤醒。
- 超限截断、artifact 与警告由 [run](run.md) 生成；这里只拼信封（`Full result:`、`Session file:`）。
- `prompts` 覆盖文案；每条 guideline 自动加 `${toolName}: ` 前缀，`{{profiles}}` 在注册时展开。覆盖 `guidelines` 却删掉 `{{profiles}}` 时，模型看不到 profile 列表；`snippet: ""` 让工具从 Available tools 消失（契约 §3）。
