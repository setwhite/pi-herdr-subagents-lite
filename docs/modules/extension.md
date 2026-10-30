# extension

pi 适配层，不持有 run 状态。`session_start` 装配 run 服务、按 `config.enabled` 注册工具、启动子侧 inbox 泵。工具的 `HERDR_ENV` 检查、文案展开与错误渲染在 [tool](tool.md)，extension 只注入配置、profile 与 service 取用函数。

`session_shutdown` 先停 inbox，再取走 service；reason 命中 `closeChildrenOn` 时走 `service.closeChildren()`（停轮询并结算 run），保留与关闭失败逐条 `notify`，未命中只 `service.shutdown()`。有子侧 inbox 时写退出回执。

auto-exit 监听也在本模块：`agent_settled` 时读 `PI_SUBAGENT_AUTO_EXIT`，inbox 为空且没有未答对话框才 `ctx.shutdown()`（DEC-0056）。
