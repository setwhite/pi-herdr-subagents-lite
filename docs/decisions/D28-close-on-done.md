# D28 完成即 release 并关 tab

完成默认 release + close；keep 不 release；父会话切换或 shutdown 关旧子代理；父进程崩溃不关、不认领。

依据：不关会僵尸复活；父崩溃后无法可靠认领。
