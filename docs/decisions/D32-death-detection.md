# D32 died 判定以 agent list 消失为准

died 判定：`agent list` 成功返回且 run 的 name 不在列表里；单次命令失败不算死亡；`agent explain` 只作人工诊断；不用 `agent wait`。

依据：父侧已有 1s 快照；不额外造等待进程。
