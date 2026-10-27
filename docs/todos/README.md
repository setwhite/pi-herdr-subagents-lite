# 任务

阶段表；任务编号全局连续，状态用文件第二行的复选框。M0（T01–T08）的 spec、任务与 E2E 记录已删，需要时看 git 历史。

- M1：T09–T15 — 全局配置、profile（含项目覆盖）、子进程参数、命名与展示、子 session 目录
- M2：T16–T18 — send 与 inbox 续聊
- R1 重构：T19–T21 — 模块改名与拆文件，行为不变
- M3 关闭：T22–T23 — 只有 `auto-exit: true` 关 tab，子代理自退
- M4 退出与状态：T24–T29 — 退出回执、agent list 快照、blocked 问题、bridge、父会话收尾
- M5 结果消息：T30–T31 — 聚合与 artifact
- M6 布局与发布：T32–T33 — 新 workspace、npm 发布
