# D28 关闭由 profile 的 auto-exit 与 closeChildrenOn 决定

完成后是否关 tab 由 profile 的 `auto-exit` 决定（默认 false，见 D47），没有全局开关；父会话结束是否关子 tab 由 `closeChildrenOn` 决定（默认空，见 D48）；keep 不 release；父进程崩溃不关、不认领。

依据：关闭要显式，避免误杀长任务；不同 profile 的收工习惯不同；崩溃后无法可靠认领。
