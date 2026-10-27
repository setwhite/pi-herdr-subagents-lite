# D29b 父侧事件订阅只服务投递

v1 不订阅 herdr 事件（D52）；若以后启用，`events.subscribe` 只服务结果投递与通知。人用 `focus_agent` / `previous_agent` 跳转；不自造快捷键、不抢焦点。

依据：v1 用 `agent list` 快照；socket 客户端与重连不进入 v1。
