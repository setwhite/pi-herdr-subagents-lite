# 0042 profile 全局 + 项目

profile 全局 + 项目，同名项目覆盖；文件名是 profile 名，frontmatter `name` 只作显示名；字段见 [v1 契约](../specs/0001-v1-contract.md)；未知字段忽略，解析失败跳过；不做 `session-mode` / `writeScope` / `denyWrites`。

依据：复用现成 profile；用户选择项目级。
