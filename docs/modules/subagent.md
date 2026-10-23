# subagent

run 生命周期内核。对外只有 SubagentService：`run`、`onResult`、`shutdown`、`active`。

负责 4 个槽、worker-N、run root/brief、串行轮询、completion_seq、结果读取重试、超过 16384 字符截断并附 session 路径、done/unknown、启动错误映射。最后一条 assistant 还有 toolCall 时继续轮询，等反问/工具返回后的最终文本。不 import pi，不拼 herdr 命令；run root 是临时目录，不承担恢复。测试不 mock 内部方法。
