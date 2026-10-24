
# v1 契约

v1 对外配置、工具、结果与 bridge。本文是实现目标，不是当前代码；当前代码是 M0，记录见 [archive/m0](../archive/m0/README.md)。决策理由见 [决策](../decisions/README.md)，提示词与简报模板见 [PROMPTS](../PROMPTS.md)。

一句话：一个工具，两个 action（`run` / `send`）；结果异步；子代理跑在 herdr pane；fresh only。

## 1. 配置

路径：

- 全局：`<agent-dir>/pi-herdr-subagents-lite/config.json`；`<agent-dir>` 默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 重定位。
- 项目：`<cwd>/.pi/pi-herdr-subagents-lite/config.json`；只在项目受信任后读取。
- 合并：按顶层键覆盖；对象值整体替换，不递归合并。
- 严格 JSON：未知键、类型错误、枚举错误启动失败并指出字段；数值越界静默 clamp。
- 只读一次；改完重启 pi 生效。文件不存在 = 全部默认。

默认值：

~~~json
{
  "enabled": true,
  "toolName": "subagent",
  "maxConcurrent": 10,
  "maxResultChars": 16384,
  "aggregateWindowMs": 500,
  "onAgentExit": "notify",
  "closeOnDone": true,
  "closeDelayMs": 0,
  "inboxPollMs": 250,
  "prompts": {},
  "bridge": {
    "enabled": true,
    "blockedOn": ["custom", "select", "confirm", "input", "editor"]
  }
}
~~~

| 键 | 类型 | 允许 | 说明 |
|---|---|---|---|
| `enabled` | boolean | — | 只控制父侧工具注册；bridge 与已跑子代理不受影响 |
| `toolName` | string | `^[a-z][a-z0-9_]{0,31}$` | 默认 `subagent`；跨扩展重名不处理 |
| `maxConcurrent` | integer | 1–32，clamp | 每个父会话的 live 子代理上限；send 重启也计数 |
| `maxResultChars` | integer | 1024–1048576，clamp | 字符数；超过则全文落 artifact |
| `aggregateWindowMs` | integer | 0–10000，clamp | 0 = 不聚合，逐个回投 |
| `onAgentExit` | string | `notify` / `restart` | restart 只在子 session 尾部没有未完成 toolCall 时生效 |
| `closeOnDone` | boolean | — | false = keep，完成后不 release、不关 pane |
| `closeDelayMs` | integer | 0–60000，clamp | closeOnDone 时关闭前等待 |
| `inboxPollMs` | integer | 50–5000，clamp | 子侧 inbox 轮询间隔 |
| `prompts` | object | — | 提示词覆盖，见 [PROMPTS](../PROMPTS.md) |
| `bridge` | object | — | 见第 7 节 |

固定文件与命令：

| 项 | 值 |
|---|---|
| 任务简报 | `<childSession>.brief.md` |
| 子侧 inbox | `<childSession>.inbox/`；父进程在 `agent start` 前创建；处理完 rename 到 `.delivered/` |
| 结果 artifact | `<childSession>.result-<seq>.md` |
| 子进程命令 | PATH 里的 `pi`，基础参数 `--session <childSession>`；其余由 profile 生成 |
| blocked 通知 | `notification show --sound request`（仅 blocked） |
| 事件源 | `pane.agent_status_changed` / `pane_agent_detected` / `pane.exited` |

## 2. Profile

路径：全局 `~/.pi/agent/agents/*.md`，项目 `.pi/agents/*.md`；同名项目覆盖全局。项目 profile 只在项目受信任后读取。

格式：YAML frontmatter + Markdown body。profile 名 = 文件名（去 `.md`）；frontmatter `name` 可选，只显示在 profile 列表。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `name` | string | 文件名 | 显示名；不影响 tab / pane / agent name |
| `description` | string | 空 | 出现在工具 guidelines 的 profile 列表 |
| `model` | string | 继承父 | provider/model 或 pi 支持的 pattern |
| `thinking` | string | 继承父 | off / minimal / low / medium / high / xhigh / max |
| `tools` | string | pi 默认 | 纯名字 = 严格 allowlist；`+name` / `-name` = 在默认集增删；两者不能混用；空字符串 = 空 allowlist |
| `skills` | string / list | 空 | 逗号分隔或 YAML 列表；每项解析为 `<agent-dir>/skills/<name>`，用 `--skill` 传入 |
| `cwd` | string | 继承父 cwd | 相对路径按父 cwd 解析；子进程在此目录启动 |
| `system-prompt` | string | 省略 | append / replace / 省略，见 [PROMPTS](../PROMPTS.md) |
| `disable-model-invocation` | boolean | false | true = 从 guidelines 隐藏，显式 run 仍可用 |

- `ask_user_question` 不自动加入；想反问就写进 `tools`。
- `subagent` 不特殊处理；不想嵌套就在 `tools` 里不写它，或在提示词里禁止。
- 未知字段忽略；解析失败只跳过该 profile，并在工具错误里说明。
- 不做 `session-mode` / `writeScope` / `denyWrites`。

## 3. 工具

注册信息：

| 项 | 值 |
|---|---|
| name | `config.toolName`，默认 `subagent` |
| label | `Subagent` |
| description / snippet / guidelines | 见 [PROMPTS](../PROMPTS.md)；profile 列表在注册时展开 |

参数：

| 字段 | 用于 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `action` | run / send | 是 | run / send | 选择动作 |
| `profile` | run | 是 | string | profile 名；未知时报错并列出可用 profile |
| `task` | run | 是 | string | 自包含任务；原样写入 brief |
| `name` | send | 是 | string | run 返回的子代理名 |
| `message` | send | 是 | string | 新消息 |

~~~json
{
  "type": "object",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action": { "const": "run" },
        "profile": { "type": "string" },
        "task": { "type": "string", "minLength": 1 }
      },
      "required": ["action", "profile", "task"]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action": { "const": "send" },
        "name": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{0,31}$" },
        "message": { "type": "string", "minLength": 1 }
      },
      "required": ["action", "name", "message"]
    }
  ]
}
~~~

返回：

~~~json
{"state":"running","name":"explore-1","paneId":"w1:p4"}
{"state":"sent","name":"explore-1"}
{"state":"restarted","name":"explore-1","paneId":"w1:p4"}
~~~

错误以 `isError: true` 返回，文本前缀是 code：

| code | 何时 | 模型看到 |
|---|---|---|
| `not_in_herdr` | 父会话不在 herdr pane | 必须在 herdr 里运行；无降级 |
| `unknown_profile` | run 的 profile 不存在 | 当前 profile 列表（name + description） |
| `unknown_agent` | send 的 name 不在 run 记录里 | 当前可用名称（含可重启的已退出项） |
| `max_concurrent` | live 子代理已达 maxConcurrent | 当前 live 名称；等结果或关一个 |
| `profile_invalid` | profile 字段解析失败 | 文件 + 字段 + 原因 |
| `spawn_failed` | tab / pane / agent start 失败 | 底层错误；已创建的 pane id 保留 |
| `agent_not_ready` | pane 未就绪、trust 对话框拦住 | 让人去 pane 处理对话框 |
| `name_exhausted` | 自动命名重试 100 次仍冲突 | 当前 live 名称；关一个再试 |
| `session_missing` | send 找不到 run 记录 / 子 session | 用 run 新建 |
| `pane_missing` | send 需要重启但 pane 已关闭 | 不自动重启；用 run 新建或人工处理 |
| `tail_dirty` | send 需要重启但 session 尾部有未完成 toolCall | 不自动重启；先检查，避免重放副作用 |
| `artifact_write_failed` | 结果超限且 artifact 写失败 | 消息带截断头部和警告，不算工具错误 |

配置错误不是工具错误：扩展加载失败，pi 启动时直接报字段。

例子：

~~~json
{"action":"run","profile":"explore","task":"Find every place that reads HERDR_ENV and summarize the call chain."}
{"action":"send","name":"explore-1","message":"Also check the Windows-specific branch."}
~~~

## 4. 命名与展示

- `name = <profile>-<n>`。profile slug：小写，非 `[a-z0-9_-]` → `-`，折叠连续 `-`，去首尾，截 16 字符；空则 `worker`；首字符不是字母则加 `agent-` 前缀。
- `n` 从 1 开始，按 profile 递增；`agent_name_taken` 时 +1 重试，最多 100 次，仍失败 `name_exhausted`。
- tab 标签 = `name`。
- 侧边栏显示 herdr 的 agent name；**不设 `display_agent`**。
- pane 标签 = 任务第一行；去掉 markdown 前缀、折叠空白、去控制字符、截 32 字。
- 不设 `title` / `state_labels`；不改 workspace label。
- `send` 用同一个 `name`。

## 5. send 语义

`send` 只负责把消息送到子代理。重启是发现子代理已退出时的副作用。inbox 轮询由子进程里的本包完成；全局安装是前提。

| 子代理状态 | send 做什么 | 返回 |
|---|---|---|
| live（working / idle / blocked） | 写 `<childSession>.inbox/`；working 时 steer，idle 时新 turn，blocked 时排队，人回答后处理；不重启 | `{state:"sent", name}` |
| 已退出，尾部没有未完成 toolCall | 同 pane 同名 `agent start`，再写 inbox | `{state:"restarted", name, paneId}` |
| 已退出，尾部有未完成 toolCall | 不重启 | `tail_dirty` |
| 已退出，pane 已关 | 不重启 | `pane_missing` |
| run 记录 / 子 session 缺失 | 不重启 | `session_missing` |

「尾部干净」只看有没有未完成的 toolCall；以 assistant 文本、toolResult、user 或 custom 消息结尾都算干净，不按工具名特判。

## 6. 结果消息

异步结果是一条 `subagent_result` 自定义消息；父模型看到的是文本，不是工具结果：

~~~text
[subagent explore-1] done (profile=explore, seq=3)

<result text, up to maxResultChars>

Full result: <childSession>.result-3.md
~~~

- 只有超过 `maxResultChars` 才写 artifact，并带 `Full result:` 行；未超限时消息不带路径。
- 聚合时一条消息里放多个块：

~~~text
[subagent explore-1] done (profile=explore, seq=2)
...

[subagent review-1] done (profile=review, seq=1)
...
~~~

- `onAgentExit: notify` 时，子代理死亡发：

~~~text
[subagent explore-1] unknown (pane exited)

The subagent exited before reporting a result. Its session is saved at
<childSession>. If its tail has no unfinished tool call, send can restart it;
otherwise inspect the child first.
~~~

- `onAgentExit: restart` 且尾部干净时先自动重启，不把这次死亡当最终 unknown；重启失败或尾部脏才发 unknown。

## 7. bridge

包内第二个扩展，随包发布；全局安装后所有 pi 进程都加载。

- 监听 `ui_prompt_start` / `ui_prompt_end`，emit `herdr:blocked`（`{active, label}`）。
- `blockedOn` 决定哪些 `ui_prompt` kind 算 blocked；默认 `custom` / `select` / `confirm` / `input` / `editor`。
- `enabled: false` 或 `blockedOn: []` = 不上报。
- `label` 取 `title`，没有则取 `kind`；herdr 集成把它作为 blocked message。
- 不依赖第三方 ask 事件；子进程即使没有 `subagent` 工具，也照常上报。
- 配置错误按第 1 节处理。
