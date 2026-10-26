# D54 子代理提问靠父侧扫 pane

不加子侧工具。父侧在 `agent_status = blocked` 时读一次 `herdr agent read <name> --lines 40 --format text`，把末尾纯文本发成 `subagent_question`；同一个 blocked 只发一次，离开 blocked 后重置。

回答由人在子 pane 里给，父模型只收到问题。依据：用户选择不做工具、不做程序化答题；复用已有的 1s 快照，不引入 `<session>.ask/` 文件协议。代价：原生 ask 弹窗只能由人在子 pane 里回答，父侧 `send` 排队到对话框关闭。

取消项：子侧 `ask_question` 工具、`<session>.ask/` 目录（参考实现 fyang93 的通道）。

备选通道（v1 不做）：本机 `ask_user_question` 来自 `@ssk_dev/rpiv-ask-user-question-lean`，其底层 `@juicesharp/rpiv-ask-user-question` 公开了 `rpiv:ask-user:prompt`（结构化问题 + `toolCallId`）与 `rpiv:ask-user:answer`（程序化答题，文档原话面向 pane supervisor），可做双向结构化往返：子进程监听 prompt 写 `<childSession>.ask/`，父侧 `send` 带 `answerTo`，子进程 emit 答题。要用时只改这两处。
