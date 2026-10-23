# extension

pi 适配层：注册工具、检查 `HERDR_ENV`、挂 `session_start` / `session_shutdown`、把结果封装成 `subagent_result`、把 ToolError 渲染成 `isError`。

不持有 run 状态，不做并发、命名、轮询、截断、JSONL 解析，也不直接碰 herdr CLI。入口注入 HerdrHost 和 SessionReader；测试从注册后的工具进入。