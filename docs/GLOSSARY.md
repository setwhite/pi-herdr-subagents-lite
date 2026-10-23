# GLOSSARY

| 术语 | 指什么 | 不是什么 |
|---|---|---|
| **herdr** | 终端 workspace / tab / pane / agent 宿主；本机 0.9.5 | 不是 pi 扩展 |
| **pi-herdr-subagents** | modem-dev 的参考扩展；现装的是 fyang93 fork | 不是 herdr 的一部分 |
| **pi-durable** | 可嵌入的 durable harness；子代理是同进程子 conversation | 没接进 pi CLI，扩展拿不到 |
| **常驻子进程** | `pi --session <file>`，可续聊、反问、steer | 不是一次性 `-p --no-session` |
| **worker** | 由 `run` 启动的 child pi 进程 | 在 M0 里不是 profile |
| **completion_seq** | herdr 记录的完成序号；结果的幂等键 | 不是消息 id，也不代表已读 |
| **blocked** | agent 正在等人处理输入 | 不靠屏幕检测；v1 靠 `herdr:blocked` |
| **subagent_result** | 回投父会话的异步结果消息 | 不是工具的同步返回值 |
| **M0** | 最小可运行闭环：run、固定 worker、异步结果 | 不是完整 v1 |
| **v1** | 全量目标：profile、send、fork、恢复、配置 | 不是 M0 的范围 |