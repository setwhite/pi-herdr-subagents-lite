# pi-herdr-subagents-lite

[English](README.md) | 简体中文

在 herdr pane 里运行 pi 子代理的扩展。一个工具、两个 action：`run` 开子代理，`send` 续聊，结果异步回到父会话。

experimental：v1 契约已定，不承诺跨版本兼容。行为细节见 [v1 契约](docs/specs/0001-v1-contract.md)。

## 功能

- **独立进程，可随时接管**：子代理是 herdr pane 里的独立 pi 进程。cwd 与父相同时开同 workspace 的新 tab，不同时新建 workspace；人可以直接切进那个 pane 接手续作。
- **profile 分两层**：Markdown + frontmatter。全局 `<agent-dir>/pi-herdr-subagents-lite/profiles/`，项目 `.pi/pi-herdr-subagents-lite/profiles/` 同名覆盖全局。
- **异步回投**：`run` 立即返回。子代理收工后，结果以 `subagent_result` 消息回到父会话；`aggregateWindowMs` 内的多个结果合并成一条消息。
- **超长结果落盘**：超过 `maxResultChars` 时全文写 artifact，消息里只留截断头部与文件路径。
- **反问交给人**：子代理弹出对话框时，父会话收到 `subagent_question`，`bridge` 把事件发成 `herdr:blocked`。人在子 pane 里回答，父模型不代答。
- **收尾可控**：profile 的 `auto-exit` 决定收工后是否自退并关 tab；`closeChildrenOn` 决定父会话以哪些原因结束时关子 tab。
- **默认禁嵌套**：子代理的工具集默认去掉本工具。要嵌套，就在 profile 的 `tools` 里显式写上工具名。
- **不是沙箱**：子代理能用哪些工具由 profile 决定，扩展不做写限制。

## 要求

| 依赖 | 说明 |
|---|---|
| herdr | 在 `0.9.5` 上验证；父会话必须在 herdr pane 里，否则报 `not_in_herdr` |
| pi | 在 `1.4.0` 上验证 |
| Node | `>= 22.19` |

## 安装

三种来源任选一种，装完重启 pi。

**npm**

```bash
pi install npm:pi-herdr-subagents-lite
```

**git**

```bash
pi install git:github.com/setwhite/pi-herdr-subagents-lite
```

**本地源码**

```bash
pi install /path/to/pi-herdr-subagents-lite                 # 装进 settings，子代理也加载
pi -e /path/to/pi-herdr-subagents-lite/src/index.ts        # 只对本次进程生效
```

`pi install` 写个人 settings（`<agent-dir>/settings.json`），对所有项目生效。**不要加 `-l`**：`-l` 只写项目 settings，子代理在别的 workspace 启动时不会加载本包，inbox 泵与 bridge 都会失效。`pi -e` 同样只影响当前进程，子代理里没有本扩展。

升级用 `pi update --extensions`，卸载用 `pi remove <source>`。装好后在 herdr pane 里启动 pi，工具列表里应出现 `subagent`（或配置的 `toolName`）。

## 快速开始

1. 在 herdr 里开个 pane，启动 `pi`。
2. 写一个 profile（见下节）。文件名去掉 `.md` 就是 `run` 用的名字。
3. 让模型调用工具，参数形如：

```json
{"action":"run","profile":"explore","task":"Read README.md and answer with its first heading."}
```

4. 返回 `{"state":"running",...}`。子代理在独立 tab 里跑；收工后 `[subagent explore-1] done` 消息回到父会话。不要在同一个回合里等结果。

续聊同一个子代理：

```json
{"action":"send","name":"explore-1","message":"Also check the Windows branch."}
```

## Profile

全局放 `<agent-dir>/pi-herdr-subagents-lite/profiles/*.md`，项目放 `.pi/pi-herdr-subagents-lite/profiles/*.md`（项目受信任后才读），同名项目覆盖全局。

```markdown
---
# 显示名，只出现在工具 guidelines 的 profile 列表；run 用的是文件名
name: Explore
description: 只读调研：读代码、答问题、不改文件

# 省略 model / thinking 就继承父会话；model 写法与 pi 一致（provider/model）
# model: provider/model
thinking: low

# 纯名字 = 严格 allowlist；+name / -name = 在默认集上增删，两种不能混用
# 省略 = pi 默认集去掉本工具（默认禁嵌套）；空字符串 = 空 allowlist
tools: read, bash

# 省略 = pi 默认发现；"" = 不加载 skill；列表 = 只加载列出的
skills: ""

# append（默认）/ replace：body 追加或替换系统提示；task：body 就是任务说明，不写身份文件
system-prompt: append

# 收工后子进程自己退出、父侧关 tab；有未答对话框或没取完 inbox 时不退
auto-exit: true

# true = 从 guidelines 隐藏，显式 run 仍可用
disable-model-invocation: false
---

You are a read-only explorer. Answer with file paths and line numbers.
```

字段含义与默认值见[契约第 2 节](docs/specs/0001-v1-contract.md#2-profile)。解析失败的 profile 不进列表；`run` 一个坏 profile 会报 `profile_invalid`，含文件、字段与原因。

### 自带示例

安装后扩展写一份示例到 `<agent-dir>/pi-herdr-subagents-lite/profiles/examples/domain.md`：只在文件缺失时写，你的改动不会被覆盖。加载只看 `profiles/*.md`，所以示例默认不生效；复制一层就能用：

```bash
cd ~/.pi/agent/pi-herdr-subagents-lite/profiles
cp examples/domain.md domain.md
```

`domain` 是通用的领域 worker：`disable-model-invocation: true` 让它不出现在工具 guidelines 里，只有你点名才用；`auto-exit: true` 让它干完关 tab。用法是把另一个领域的活连同上下文交给它，让子代理用新上下文接着做。

## 配置

路径：`<agent-dir>/pi-herdr-subagents-lite/config.json`。`<agent-dir>` 默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 重定位。只有全局一份，不读项目配置。

### 最小配置

文件不存在 = 全部默认。只改一项就只写一项：

```json
{
  "maxConcurrent": 4
}
```

### 完整配置

下面列出所有键，值与默认值一致。配置必须是严格 JSON：未知键、类型错、枚举错都会让扩展加载失败，pi 直接退出并指出字段。示例里的 `//` 是注释，复制时要删掉。

```jsonc
{
  // 只控制工具注册；bridge 由 bridge.enabled 单独控制；已跑的子代理不受影响
  "enabled": true,

  // 工具名，模型看到的就是它；写法 ^[a-z][a-z0-9_]{0,31}$
  "toolName": "subagent",

  // herdr 可执行文件。默认按 PATH 解析；写绝对路径可以固定版本
  "herdrBin": "herdr",

  // 每个父会话同时存活的子代理上限。auto-exit 为 false 的子代理收工后仍占一个槽
  "maxConcurrent": 16,

  // 单条结果的字符上限（1024–1048576）。超过就把全文写 artifact，消息里留截断头部与路径
  "maxResultChars": 16384,

  // 聚合窗口（0–10000 毫秒）。窗口内的多个结果合并成一条消息；0 = 逐条立即回投
  "aggregateWindowMs": 500,

  // 父会话以这些原因结束时关掉它的子 tab。空数组 = 一律不关
  // 可选值：new / resume / fork / quit / reload
  "closeChildrenOn": [],

  // 子代理侧轮询 inbox 的间隔（50–5000 毫秒）
  "inboxPollMs": 250,

  // 父侧轮询 herdr agent list 的间隔（100–60000 毫秒）。调大省进程，调小更快发现收工
  "pollIntervalMs": 1000,

  // 覆盖工具文案。省略的键用内置文案；下面的值是占位符，不用就整段删掉
  "prompts": {
    "description": "一句话说明这个工具做什么",
    "snippet": "Available tools 里显示的一行说明",
    // 整体替换内置 guidelines；要保留 profile 列表，就留一行含 {{profiles}} 的文本
    "guidelines": ["Do not wait for a result in this turn.", "Available profiles:\n{{profiles}}"]
  },

  // bridge：把 pi 的对话框事件发成 herdr:blocked，供原生提醒使用
  "bridge": {
    "enabled": true,
    // 哪类对话框算 blocked；默认全部
    "blockedOn": ["custom", "select", "confirm", "input", "editor"]
  }
}
```

数值超出范围不报错，静默 clamp 到边界。配置只读一次，改完要重启 pi。

## 参考项目

设计取自下列项目，特此致谢：

| 项目 | 借鉴 |
|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi) | 扩展 API、包布局、官方示例 |
| [fyang93/pi-herdr-subagents](https://github.com/fyang93/pi-herdr-subagents) | profile 字段形状、独立 herdr session 的集成测试做法 |
| [modem-dev/pi-herdr-subagents](https://github.com/modem-dev/pi-herdr-subagents) | herdr 启动方式与生命周期、结束状态归档思路 |
| [purboo/pi-durable-subagents](https://github.com/purboo/pi-durable-subagents) | 异步回投、幂等、「只上报一次」的消息设计 |

## 文档

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 模块边界、依赖方向、测试 seam |
| [v1 契约](docs/specs/0001-v1-contract.md) | 配置、profile、工具、send、结果、bridge |
| [GLOSSARY](docs/GLOSSARY.md) | 术语 |
| [决策索引](docs/decisions/README.md) | 一份决定一个文件 |
| [herdr 恢复与状态实测](docs/research/herdr-恢复与状态实测.md) | herdr 行为依据 |
| [herdr agent list 实测](docs/research/herdr-agent-list.md) | `agent list` 原文与字段结论 |
| [herdr workspace create 实测](docs/research/herdr-workspace-create.md) | `workspace create` / `tab create --workspace` 的字段 |
| [pi install 与 pack 产物实测](docs/research/pi-install-pack.md) | tarball 不是 pi 包源；本地验证用 npm 布局 |

## 开发

| 命令 | 作用 |
|---|---|
| `pnpm install` | 装依赖 |
| `pnpm check` | 提交前全跑：lint → 导入边界 → 类型 → 单测 |
| `pnpm lint` | biome 检查 |
| `pnpm check:imports` | 依赖方向检查 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | 单测（vitest） |
| `pnpm test:e2e` | 真机 E2E：真 herdr + 真 pi 子进程 |

启用提交钩子，之后就自动跑 `pnpm check`：

```bash
git config core.hooksPath .githooks
```

E2E 不在 `pnpm check` 里，单独跑。它自己起隔离的 herdr session 与 agent 目录，缺 herdr、pi 或 `auth.json` 时整组跳过并给出原因。

| 环境变量 | 作用 |
|---|---|
| `PI_E2E_MODEL=provider/model` | 换 E2E 用的模型 |
| `PI_E2E_KEEP=1` | 保留临时目录，便于事后排查 |

## 许可

MIT，见 [LICENSE](LICENSE)。
