# pi-herdr-subagents-lite

在 herdr pane 里运行 pi 子代理的扩展。M0 只验证最小闭环；v1 目标见决策表。

扩展入口是 `src/index.ts`；pi 用 jiti 直接加载 TypeScript，不需要构建。

## 文档

- [M0 spec](docs/specs/0001-m0-minimal-subagent.md) — 当前实现范围、接口与验收；写代码前先看。
- [ARCHITECTURE](docs/ARCHITECTURE.md) — M0 模块边界、依赖与测试 seam。
- [配置与工具面](docs/配置与工具面.md) — v1 配置、工具 schema、提示词；M0 不实现。
- [DECISIONS](docs/DECISIONS.md) — v1 决策与理由。
- [GLOSSARY](docs/GLOSSARY.md) — 术语。
- [extension 模块](src/extension/README.md) — pi 工具与消息封装。
- [subagent 模块](src/subagent/README.md) — run 生命周期与结果内容。
- [herdr 模块](src/herdr/README.md) — HerdrHost 端口与 CLI 适配。
- [session 模块](src/session/README.md) — 子 session 结果读取。
- [参考项目对比](docs/research/子代理实现对比.md) — 路线选型依据。
- [herdr 恢复与状态实测](docs/research/herdr-恢复与状态实测.md) — herdr 行为依据。
- [pi-herdr-subagents 参考](docs/research/pi-herdr-subagents-参考.md) — 参考实现的流程、字段与取舍。