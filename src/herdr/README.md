# herdr

HerdrHost 端口与唯一真实适配器：`createTab`、`renameTab`、`startAgent`、`getAgent`、`closeTabIfOnlyPane`。

argv 不经过 shell；解析 JSON；解析出的 CLI 错误码里，`agent_name_taken` 归一成 `name_taken`，`agent_not_found` 在 getAgent 里转为 null，其余原样抛出。extension/subagent 只依赖端口，测试用 fake host；真实 CLI 的字段由手工 E2E 校准。叶子模块，不 import 其他模块。