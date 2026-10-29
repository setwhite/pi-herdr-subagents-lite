# 0054 提问正文来自子 session 尾部

父侧在 `agent_status = blocked` 时读子 session 尾部最后一个 assistant 消息的 toolCall 参数，把问题与选项拼成 `subagent_question`（去重见契约 §6）。没有 toolCall 或取不到文本时只发头部与尾注。

不自造通道：子代理用自己的 `ask_user_question`，回答由人在子 pane 给，父模型只收到问题。不扫 pane：pane 是渲染结果，行数无法同时适配长短对话框；toolCall 参数是原始数据，不截断，也不需要配置。

备选通道（v1 不做）：本机 `ask_user_question` 来自 `@ssk_dev/rpiv-ask-user-question-lean`，其底层 `@juicesharp/rpiv-ask-user-question` 公开了 `rpiv:ask-user:prompt`（结构化问题 + `toolCallId`）与 `rpiv:ask-user:answer`（程序化答题，文档原话面向 pane supervisor），可做双向结构化往返：子进程监听 prompt 写 `<childSession>.ask/`，父侧 `send` 带 `answerTo`，子进程 emit 答题。要用时只改这两处。
