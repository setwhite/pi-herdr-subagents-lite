# herdr

`HerdrHost` 端口与唯一真实适配器。CLI 全部用 `execFile` 的 argv，不经 shell。本文只写取舍。

## 调用

- `workspace create` 返回 workspace、初始 tab 与 root pane。跨 cwd 的 run 直接复用这套结果，再 `tab rename` 把初始 tab 的 label 从序号改成 `name`；不追加第二个 tab（[实测](../research/0004-herdr-workspace-create.md)）。关掉 workspace 的最后一个 tab 后，herdr 移除该 workspace。
- `workspace create` 与 `tab create` 都收 `--env`；每个 run 显式传 `PI_SUBAGENT_AUTO_EXIT`，不靠继承（DEC-0056）。
- 启动只有 `agent start` 一步，它在子代理 idle 时才算就绪，命令自身 30s 上限。brief 不放进启动 argv，也不打字进输入框：它是 inbox 的第一条消息，且在 `agent start` 返回后才入队（DEC-0023、DEC-0026）。
- `closeTabIfOnlyPane` 只在 tab 恰好一个 pane 且就是该 pane 时关。多 pane 返回 `kept`，tab 已不存在返回 `missing`：同一 tab 里可能有人的 pane。
- `listAgents` 一次覆盖所有 agent；完成序号取 `completion_seq`，缺失时退回 `state_change_seq`。字段依据见 [agent list 实测](../research/0002-herdr-agent-list.md)。

## 错误

- 从 stdout / stderr 解析 `error.code`；`agent_name_taken` 归一成 `name_taken`，其余原样抛出。
- 非法 JSON 或没有 `result` 归为 `herdr_protocol`，不猜。
