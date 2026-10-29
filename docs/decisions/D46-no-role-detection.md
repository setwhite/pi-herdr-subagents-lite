# D46 角色只看 inbox 目录

不用环境变量 marker、loadout、进程探测；本进程是不是子代理只看 `<sessionFile>.inbox/` 是否存在。全局安装后子进程也加载本包；子进程是否有 `subagent` 工具由 profile 的 `tools` 决定；嵌套只靠提示词与 profile tools，不做深度管理。

依据：用户选择；目录已存在，不需要额外状态；fork 后保留 `subagent` 工具时这条信号仍成立。
