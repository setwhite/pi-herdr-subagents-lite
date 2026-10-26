# D47 完成后默认保留 tab

`auto-exit` 默认 false；完成后不 release、不关 tab，子代理继续存活并占用一个 `maxConcurrent` 槽，`send` 可以续聊；要收工自退就在 profile 里设 `auto-exit: true`。

依据：默认关闭会让完成后的 `send` 无目标；保留让「关闭」只由用户或 profile 触发；自退由子进程判断，能看到未答对话框与排队消息。
