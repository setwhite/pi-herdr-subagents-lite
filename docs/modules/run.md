# run

run 生命周期内核。run 先解析 profile（缺 → `unknown_profile`，坏字段 → `profile_invalid`，都在占槽之前），再占槽、命名、建 pane、启动、投 brief。轮询每拍一次 `agent list` 快照，按 `pane_id` 与 `name` 定位 run，比较完成序号，读子 session 尾部，投递后前移游标。`send` 按名字查记录：活着写 inbox，已退出则重启续聊。`close.ts` 管两种关闭：done 且 `auto-exit: true` 由 `finish` 关 tab；`session_shutdown` 命中 `closeChildrenOn` 时 `closeChildren` 先 settle 全部 run（expected），再逐个关 tab，缺席分支因 run 已停而不会投递 `pane_exited`。`closeChildren` 返回保留（`kept`）与关闭失败（`failed`）的 run 名；`missing` 视为已关，不记入结果。通知由 extension 做。

`send` 与轮询共用同一套定位逻辑（`find.ts`）；改名不影响寻址（D52）。

`question.ts` 管 blocked 提问：`agent_status = blocked` 时读一次 pane 末尾，同一次 blocked 只发一次，离开 blocked 即重置；非 blocked 不读 pane（D54）。读 pane 失败按轮询失败计数，连续 3 次结算 `poll_failed`。提问信封在 [tool](tool.md)。
