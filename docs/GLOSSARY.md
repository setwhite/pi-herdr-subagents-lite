# GLOSSARY

| 术语 | 指什么 | 不是什么 |
|---|---|---|
| **herdr** | 终端 workspace / tab / pane / agent 宿主；本机 0.9.5 | 不是 pi 扩展 |
| **pi-herdr-subagents** | 同名参考项目：本机装的是 fyang93 1.1.0；另有 modem-dev 版本 | 不是 herdr 的一部分，也不是本项目的 fork 来源 |
| **pi-durable** | 可嵌入的 durable harness；子代理是同进程子 conversation | 没接进 pi CLI |
| **常驻子进程** | `pi --session <file>`，可续聊、反问、steer | 不是一次性 `-p --no-session` |
| **profile** | 角色模板；全局 `~/.pi/agent/agents/*.md` + 项目 `.pi/agents/*.md`；文件名是 profile 名 | 不是 agent name |
| **子代理名** | `<profile>-<n>`，herdr live agent name；run 返回，send 用它 | 不是 profile 名，也不是 pane 标题 |
| **tab label** | tab 栏文字；v1 等于子代理名 | 不是 agent name 字段 |
| **pane label** | pane 头文字；v1 是任务第一行 | 不是 tab label |
| **completion_seq** | herdr 记录的完成序号；v1 与该 run 的 `lastHandledSeq` 比较去重 | 不是消息 id，也不代表已读 |
| **blocked** | agent 正在等人处理输入；v1 由 bridge 监听 `ui_prompt_*` 上报 | 不靠屏幕检测 |
| **bridge** | 同一扩展内的监听器；`ui_prompt_start/end` → `herdr:blocked`（v1） | 不是 herdr 自带集成，也不是第二个入口 |
| **subagent_result** | 回投父会话的异步结果消息 | 不是工具的同步返回值 |
| **subagent_question** | 子代理 blocked 时，父侧转发其 pane 末尾文本的消息（v1） | 不是子代理主动调的工具 |
| **auto-exit** | profile 字段；true = 子代理收工后自己 shutdown，父侧关 tab（v1） | 不是全局配置 |
| **exit 回执** | `<childSession>.exit`，子进程写 `{type, summary, errorMessage}`（v1） | 不是 session 文件本身 |
| **M0** | 最小闭环：run、固定 worker、异步结果 | 不是完整 v1 |
| **v1** | profile（含 auto-exit）、send 含续聊、blocked bridge、死亡回执、问题转发、npm 发布 | 不含 fork，死亡不自动重启 |
