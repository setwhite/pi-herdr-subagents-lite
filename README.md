
# pi-herdr-subagents-lite

在 herdr pane 里运行 pi 子代理的扩展。当前代码支持 `run`、`send`、全局与项目 profile；其余 v1 行为见 [任务台账](docs/todos/README.md)，契约见 [v1 契约](docs/specs/0001-v1-contract.md)。公开 npm 包（发布后）；experimental，不承诺版本兼容。

## 安装

发布后：

~~~bash
pi install npm:pi-herdr-subagents-lite
~~~

全局安装加载一个扩展，同时提供 `subagent` 工具与 bridge；bridge 要在子进程里生效，必须全局安装。npm 发布在 M6（见 [任务台账](docs/todos/README.md)）；当前 `package.json` 仍是 `private: true`。

开发时直接加载源码：

~~~bash
pi -e ./src/index.ts
~~~

## 用法

在 herdr pane 里启动 pi 后，先写一个 profile（`<agent-dir>/pi-herdr-subagents-lite/profiles/<name>.md`，YAML frontmatter + body；受信项目可用 `.pi/pi-herdr-subagents-lite/profiles/<name>.md` 覆盖），再调 `subagent` 的 `run`：

~~~json
{"action":"run","profile":"explore","task":"Read README.md and answer with its first heading."}
~~~

返回 `{"state":"running","name":"explore-1","paneId":"...","sessionFile":"..."}`。子代理在独立 tab 里跑；结果稍后以 `[subagent explore-1] done` 消息回到父会话，不要在同一个回合里等。不在 herdr 里调用返回 `not_in_herdr`。

全局配置在 `<agent-dir>/pi-herdr-subagents-lite/config.json`；键、默认值与校验见 [v1 契约](docs/specs/0001-v1-contract.md) 第 1 节。

## 开发

~~~bash
pnpm install
pnpm check                            # lint + check:imports + typecheck + test
git config core.hooksPath .githooks   # 启用 pre-commit，一次即可
~~~

真实 herdr 的手工 E2E 见 [e2e/herdr.md](docs/e2e/herdr.md)。

## 文档

- [ARCHITECTURE](docs/ARCHITECTURE.md) — 模块边界、依赖、测试 seam、模块文档索引。
- [v1 契约](docs/specs/0001-v1-contract.md) — v1 配置、profile、工具、send、结果、bridge。
- [决策](docs/decisions/README.md) — 决策与理由、取消项、边界与验证。
- [GLOSSARY](docs/GLOSSARY.md) — 术语。
- [herdr E2E](docs/e2e/herdr.md) — 当前的手工回归 runbook。
- [任务台账](docs/todos/README.md) — v1 里程碑。
- [参考实现](docs/research/reference-implementations.md) — durable、两个 herdr 参考、官方 example。
- [herdr 恢复与状态实测](docs/research/herdr-恢复与状态实测.md) — herdr 行为依据。
- [herdr agent list 实测](docs/research/herdr-agent-list.md) — `agent list` 原文与字段结论。
- [herdr workspace create 实测](docs/research/herdr-workspace-create.md) — `workspace create` / `tab create --workspace` 的字段与初始 tab。
