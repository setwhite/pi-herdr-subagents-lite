# bridge

`createBridge(pi, config.bridge)` 在扩展加载时注册两个监听，不依赖 session：

- `ui_prompt_start`：`kind` 命中 `blockedOn` 时 emit `herdr:blocked` `{ active: true, label }`；`label` 取 `title`，没有则取 `kind`。
- `ui_prompt_end`：同一过滤条件下 emit `{ active: false }`。

`bridge.enabled: false` 时不注册监听；顶层 `enabled: false` 不影响 bridge（DEC-0049）。每个命中的 start / end 各 emit 一次，bridge 不合并嵌套弹窗；end 不带 `label`。
