
# pi-herdr-subagents-lite

在 herdr pane 里运行 pi 子代理的扩展。契约见 [v1 契约](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/specs/0001-v1-contract.md)；experimental，不承诺版本兼容。

## 安装

~~~bash
pi install npm:pi-herdr-subagents-lite
~~~

`pi install` 默认写个人 settings（`<agent-dir>/settings.json`），对所有项目生效。不要加 `-l`：必须全局安装，子进程才加载本包，bridge 与 inbox 泵才在子代理里生效。

开发时直接加载源码：

~~~bash
pi -e ./src/index.ts
~~~

## 用法

在 herdr pane 里启动 pi 后，先写一个 profile（`<agent-dir>/pi-herdr-subagents-lite/profiles/<name>.md`，YAML frontmatter + body；受信项目可用 `.pi/pi-herdr-subagents-lite/profiles/<name>.md` 覆盖），再调 `subagent` 的 `run`：

~~~json
{"action":"run","profile":"explore","task":"Read README.md and answer with its first heading."}
~~~

返回 `{"state":"running",...}`，字段见契约 §3。子代理在独立 tab 里跑；结果稍后以 `[subagent explore-1] done` 消息回到父会话，不要在同一个回合里等。

全局配置的键、默认值与校验见 [v1 契约](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/specs/0001-v1-contract.md) 第 1 节。

## 开发

~~~bash
pnpm install
pnpm check                            # lint + check:imports + typecheck + test
git config core.hooksPath .githooks   # 启用 pre-commit，一次即可
~~~

真实 herdr 的手工 E2E 见 [e2e/herdr.md](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/e2e/herdr.md)。

## 文档

- [ARCHITECTURE](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/ARCHITECTURE.md) — 模块边界、依赖、测试 seam、模块文档索引。
- [v1 契约](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/specs/0001-v1-contract.md) — v1 配置、profile、工具、send、结果、bridge。
- [GLOSSARY](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/GLOSSARY.md) — 术语。
- [herdr E2E](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/e2e/herdr.md) — 当前的手工回归 runbook。
- [参考实现](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/research/reference-implementations.md) — durable、两个 herdr 参考、官方 example。
- [herdr 恢复与状态实测](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/research/herdr-恢复与状态实测.md) — herdr 行为依据。
- [herdr agent list 实测](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/research/herdr-agent-list.md) — `agent list` 原文与字段结论。
- [herdr workspace create 实测](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/research/herdr-workspace-create.md) — `workspace create` / `tab create --workspace` 的字段与初始 tab。
- [pi install 与 pack 产物实测](https://github.com/setwhite/pi-herdr-subagents-lite/blob/main/docs/research/pi-install-pack.md) — tarball 不是 pi 包源；本地验证用 npm 布局。
