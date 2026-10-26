# D37 只有全局配置

配置只有全局一份 `<agent-dir>/pi-herdr-subagents-lite/config.json`；不读项目配置。严格 JSON，未知键/类型/枚举失败，数值越界 clamp；改完重启。

依据：用户选择；项目配置会让父进程与不同 cwd 的子进程读到不同值。
