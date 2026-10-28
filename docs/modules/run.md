# run

run 生命周期内核。run 先解析 profile（缺 → `unknown_profile`，坏字段 → `profile_invalid`，都在占槽之前），再占槽、命名、建 pane、启动、投 brief。轮询每拍一次 `agent list` 快照，按 `pane_id` 与 `name` 定位 run，比较完成序号，读子 session 尾部，投递后前移游标。`send` 按名字查记录：活着写 inbox，已退出则重启续聊。`close` 决定何时关 tab：只有 `auto-exit: true` 与命中 `closeChildrenOn` 才关。

`send` 与轮询共用同一套定位逻辑（`find.ts`）；改名不影响寻址（D52）。

`question.ts` 管 blocked 提问：`agent_status = blocked` 时读一次 pane 末尾，同一次 blocked 只发一次，离开 blocked 即重置；非 blocked 不读 pane（D54）。读 pane 失败按轮询失败计数，连续 3 次结算 `poll_failed`。提问信封在 [tool](tool.md)。
