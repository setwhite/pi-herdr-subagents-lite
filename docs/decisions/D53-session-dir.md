# D53 子 session 放在 agent dir

子 session 在 `<agent-dir>/pi-herdr-subagents-lite/sessions/<name>-<runId>.jsonl`；brief、inbox、artifact 是它的兄弟文件，不建 run root。`runId` 每个 run 唯一，不复用。

依据：用户选择；临时目录会被系统清掉，人工恢复不可靠；`<childSession>.inbox/` 同时是「本进程是子代理」的信号。
