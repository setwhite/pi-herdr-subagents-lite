# inbox

`<childSession>.inbox/` 的唯一读写口。`enqueue` 先写临时文件再 rename 成按进程内单调时间排序的 `.md`；`drain` 按文件名顺序逐条投递，成功后 rename 到 `.delivered/`，回调抛错即停并留下该文件。`pumpInbox` 每 `pollMs` 调一次调用方注入的 `tick`，每拍结果经 `onCycle` 交回调用方；消息前缀、失败计数与上限都不在这里。
