# herdr

`HerdrHost` 端口与唯一真实适配器。CLI 调用全部走 `execFile` 的 argv，不经 shell；解析 JSON；`agent_name_taken` 归一成 `name_taken`，其余原样抛出。`startAgent` 先 `agent start` 到 idle，再 `agent prompt @brief`；brief 不放进启动 argv，否则带首轮任务的长任务会让启动等待超时。`resumeAgent` 只做 `agent start`。`listAgents` 一次 `agent list` 覆盖所有 agent；字段依据见 [herdr agent list 实测](../research/herdr-agent-list.md)。
