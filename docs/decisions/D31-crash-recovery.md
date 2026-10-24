# D31 子代理崩溃默认 notify

子代理崩溃默认 notify；`onAgentExit: restart` 只在尾部没有未完成 toolCall 时同 pane 同名重启一次；`send` 需要重启时同样检查，否则 `tail_dirty`。herdr server 重启用 session 路径恢复；全局安装后不依赖 `-e`。

依据：实测：`-e` 丢失；悬空 toolCall 会变成 No result provided，模型可能重试副作用。
