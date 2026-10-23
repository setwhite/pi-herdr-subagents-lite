# pi-herdr-subagents-lite

在 herdr pane 里运行 pi 子代理的扩展。M0 只验证最小闭环；v1 目标见决策表。

## 安装

扩展入口是 `src/index.ts`；pi 用 jiti 直接加载 TypeScript，不需要构建。目前不发布 npm，直接在 herdr pane 内用 `-e` 加载：

~~~bash
pi -e ./src/index.ts
~~~

## 开发

~~~bash
pnpm install
pnpm check                            # lint + check:imports + typecheck + test
git config core.hooksPath .githooks   # 启用 pre-commit，一次即可
~~~

真实 herdr 的手工 E2E 见 [M0 spec](docs/specs/0001-m0-minimal-subagent.md) 与 `docs/todos/T07.md`、`docs/todos/T08.md`。

## 文档

- [M0 spec](docs/specs/0001-m0-minimal-subagent.md) — 当前实现范围、接口与验收；写代码前先看。
- [ARCHITECTURE](docs/ARCHITECTURE.md) — 模块边界、依赖、目录 / 测试 / 文档约定。
- [配置与工具面](docs/配置与工具面.md) — v1 配置、工具 schema、提示词；M0 不实现。
- [DECISIONS](docs/DECISIONS.md) — v1 决策与理由。
- [GLOSSARY](docs/GLOSSARY.md) — 术语。
- 模块文档：[extension](docs/modules/extension.md)、[subagent](docs/modules/subagent.md)、[herdr](docs/modules/herdr.md)、[session](docs/modules/session.md)。
- [任务台账](docs/todos/README.md) — M0 的 T01–T08 与后续里程碑。
- [审计记录](docs/audit/) — 每个任务的只读审计结论。
- [参考项目对比](docs/research/子代理实现对比.md) — 路线选型依据。
- [herdr 恢复与状态实测](docs/research/herdr-恢复与状态实测.md) — herdr 行为依据。
- [pi-herdr-subagents 参考](docs/research/pi-herdr-subagents-参考.md) — 参考实现的流程、字段与取舍。
