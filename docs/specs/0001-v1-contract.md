
# v1 契约

v1 对外配置、工具、结果与 bridge。本文是实现目标，不是当前代码；当前实现范围见 [任务台账](../todos/README.md)。决策理由见 [决策](../decisions/README.md)，提示词与简报模板见 [PROMPTS](../PROMPTS.md)。

一句话：一个工具，两个 action（`run` / `send`）；结果异步；子代理跑在 herdr pane；fresh only。

## 1. 配置

路径：

- 只有全局一份：`<agent-dir>/pi-herdr-subagents-lite/config.json`；`<agent-dir>` 默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 重定位。不读项目配置。
- 严格 JSON：未知键、类型错误、枚举错误 = 配置无效；不注册工具，错误里指出字段；pi 继续运行。数值越界静默 clamp。
- 只读一次；改完重启 pi 生效。文件不存在 = 全部默认。

默认值与 clamp 边界以 `src/config/index.ts` 与 `test/config.test.ts` 为准；本表只写语义。

| 键 | 类型 | 允许 | 说明 |
|---|---|---|---|
| `enabled` | boolean | — | 只控制工具注册；bridge 由 `bridge.enabled` 独立控制；已跑子代理不受影响 |
| `toolName` | string | `^[a-z][a-z0-9_]{0,31}$` | 默认 `subagent`；跨扩展重名不处理 |
| `maxConcurrent` | integer | 越界 clamp | 每个父会话的 live 子代理上限；只有下界，无上限；`auto-exit: false` 的 done 子代理仍算 live |
| `maxResultChars` | integer | 越界 clamp | 字符数；超过则全文落 artifact |
| `aggregateWindowMs` | integer | 越界 clamp | 0 = 不聚合，逐个回投 |
| `closeChildrenOn` | string[] | `new` / `resume` / `fork` / `quit` / `reload` | 空 = 不关；命中 `session_shutdown.reason` 时关该父会话的子 tab |
| `inboxPollMs` | integer | 越界 clamp | 子侧 inbox 轮询间隔 |
| `prompts` | object | — | 提示词覆盖，见 [PROMPTS](../PROMPTS.md) |
| `bridge` | object | — | 见第 7 节 |

完成后的关闭由 profile 的 `auto-exit` 决定，见第 2 节；没有全局开关。保留的 done 子代理仍占一个槽；要释放就设 `auto-exit: true` 或人工关 tab。

`closeChildrenOn` 只在 `session_shutdown` 的 reason 命中时生效：关闭该父会话拥有的子 tab，子进程随之结束；未命中只停止投递，不关 tab。关 tab 前标记为 expected，不发死亡通知。tab 有多个 pane 时不关，保留并通知。父进程崩溃没有 shutdown，不关、不认领。

固定文件与命令：

| 项 | 值 |
|---|---|
| 子 session | `<agent-dir>/pi-herdr-subagents-lite/sessions/<name>-<runId>.jsonl`；`runId` 每个 run 唯一，不复用 |
| 任务简报 | `<childSession>.brief.md` |
| 身份文件 | `<childSession>.identity.md`；profile body，`--append-system-prompt` / `--system-prompt` 用；续聊沿用同一文件 |
| 子侧 inbox | `<childSession>.inbox/`；父进程在 `agent start` 前创建；处理完 rename 到 `.delivered/` |
| 结果 artifact | `<childSession>.result-<seq>.md` |
| 子进程命令 | PATH 里的 `pi`，基础参数 `--session <childSession>`；其余由 profile 生成 |
| blocked 通知 | `notification show --sound request`（仅 blocked） |
| blocked 事件源 | pi `ui_prompt_start` / `ui_prompt_end` |
| 退出回执 | `<childSession>.exit`；子进程 `session_shutdown` 时写 `{reason}`；只有 `<childSession>.inbox/` 存在时才写 |
| 问题观察 | 父侧在 blocked 时读 `herdr agent read <name> --lines 40 --format text` |

## 2. Profile

路径：全局 `<agent-dir>/pi-herdr-subagents-lite/profiles/*.md`，项目 `.pi/pi-herdr-subagents-lite/profiles/*.md`；同名项目覆盖全局。项目 profile 只在项目受信任后读取。

格式：YAML frontmatter + Markdown body。profile 名 = 文件名（去 `.md`）；frontmatter `name` 可选，只显示在 profile 列表。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `name` | string | 文件名 | 显示名；不影响 tab / pane / agent name |
| `description` | string | 空 | 出现在工具 guidelines 的 profile 列表 |
| `model` | string | 继承父 | provider/model 或 pi 支持的 pattern |
| `thinking` | string | 继承父 | off / minimal / low / medium / high / xhigh / max |
| `tools` | string | pi 默认 | 纯名字 = 严格 allowlist；`+name` / `-name` = 在默认集增删；两者不能混用；空字符串 = 空 allowlist |
| `skills` | string / list | 省略 | 省略 = pi 默认发现；`""` 或 `[]` = `--no-skills`，不加载 skill；非空列表 = `--no-skills` + 每项解析为 `<agent-dir>/skills/<name>` 并用 `--skill` 传入，只加载指定项；列表项是名字，不带 `+` / `-` |
| `cwd` | string | 继承父 cwd | 相对路径按父 cwd 解析；子进程在此目录启动；与父 cwd 不同时在新 workspace 里开 tab，相同则在同 workspace 开新 tab |
| `system-prompt` | string | append | append / replace / task；省略 = append，见 [PROMPTS](../PROMPTS.md) |
| `auto-exit` | boolean | false | true = 任务收工后子进程自己 shutdown，父侧关 tab；有未答对话框或未取 inbox 消息时不退 |
| `disable-model-invocation` | boolean | false | true = 从 guidelines 隐藏，显式 run 仍可用 |

- `ask_user_question` 不自动加入；想反问就写进 `tools`。
- `subagent` 不特殊处理；不管理嵌套深度，不强制拦截；不想嵌套就在 `tools` 里不写它，或在提示词里禁止。
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
| `unknown_agent` | send 的 name 不在 run 记录里 | 当前可用名称 |
| `max_concurrent` | live 子代理已达 maxConcurrent | 当前 live 名称；等结果或关一个 |
| `profile_invalid` | profile 字段解析失败 | 文件 + 字段 + 原因 |
| `spawn_failed` | tab / pane / agent start 失败 | 底层错误；已创建的 pane id 保留 |
| `agent_not_ready` | pane 未就绪、trust 对话框拦住 | 让人去 pane 处理对话框 |
| `name_exhausted` | 自动命名重试 100 次仍冲突 | 当前 live 名称；关一个再试 |
| `tail_dirty` | 需要重启，但 session 尾部有未完成 toolCall | 不重启；先检查，避免重放副作用 |
| `session_missing` | send 的 run 记录存在，但子 session 文件不存在 | 用 run 新建 |
| `artifact_write_failed` | 结果超限且 artifact 写失败 | 消息带截断头部和警告，不算工具错误 |

配置错误不是工具错误：不注册工具；pi 显示 extension error；不中止启动。

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
- 人改 tab 标签不影响寻址；寻址用 agent name。agent 被 `herdr agent rename` 改名后，按 run 记录的 `paneId` 在 `agent list` 里回落匹配。

## 5. send 语义

`send` 把消息送到子代理；子代理已退出时用同一 session 重启续聊。inbox 轮询由子进程里的本包完成；全局安装是前提。

| 子代理状态 | send 做什么 | 返回 |
|---|---|---|
| agent 存在（working / idle / blocked / done / unknown） | 写 `<childSession>.inbox/`；working 时 steer，idle / done 时新 turn，blocked / unknown 时排队，人回答后处理 | `{state:"sent", name}` |
| 已退出，pane 还在，尾部干净 | 同 pane、同名 `agent start --session <childSession>`，再写 inbox；profile 重新读取 | `{state:"restarted", name, paneId}` |
| 已退出，pane 已关（auto-exit） | 新建 tab，同名 `agent start --session <childSession>`，再写 inbox | `{state:"restarted", name, paneId}` |
| 已退出，尾部有未完成 toolCall | 不重启 | `tail_dirty` |
| 子 session 文件不存在 | 不重启 | `session_missing` |
| name 不在 run 记录 | 不投递 | `unknown_agent` |

「尾部干净」只看有没有未完成的 toolCall；以 assistant 文本、toolResult、user 或 custom 消息结尾都算干净。

## 6. 结果消息

完成检测：父侧每 1s 调一次 `herdr agent list`；按 run 的 `pane_id` 定位、`name` 兜底，`completion_seq` 大于该 run 的 `lastHandledSeq` 且状态为 `idle` / `done` 时读子 session 尾部，投递后把 `lastHandledSeq` 更新为该值。单次 `agent list` 失败不是死亡；只有成功返回且 run 的 `pane_id` 与 `name` 都不在列表里才算死亡。不订阅 herdr 事件。

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

- 子代理死亡时先读 `<childSession>.exit`（只有 `{ reason }`）：

| 回执 | 投递 |
|---|---|
| 有回执，session 尾部有最终文本且没有未完成 toolCall | `done`，正文取该文本 |
| 有回执，尾部没有可用文本 | `unknown (quitted)` |
| 没有回执（没走 shutdown） | 退回读 session 尾部，同上判定；否则 `unknown (pane exited)` |

- 已经投递过的 run 不再因回执重复投递。

~~~text
[subagent explore-1] unknown (pane exited)

The subagent stopped before reporting a result.
Its session is saved at <childSession>.
~~~

- 死亡消息是该 run 的终态：最多一条，不受 `lastHandledSeq` 约束。
- 子代理 blocked（`agent_status = blocked`）时，父侧读一次 pane 末尾并发 `subagent_question`：

~~~text
[subagent explore-1] blocked (question)

<child pane 末尾 40 行纯文本>

The human answers it in the child's pane. A follow-up sent with send is
queued until the dialog closes.
~~~

- 同一个 blocked 只发一次，离开 blocked 后重置。
- `auto-exit: true` 的子代理退出后，父侧先投递结果，再关只含该 pane 的 tab。

## 7. bridge

同一扩展内的监听器，不单独入口；全局安装后所有 pi 进程都加载。

- 不单独注册工具；顶层 `enabled: false` 只跳过工具，bridge 仍按 `bridge.enabled` 工作。
- 监听 `ui_prompt_start` / `ui_prompt_end`，emit `herdr:blocked`（`{active, label}`）。
- `blockedOn` 决定哪些 `ui_prompt` kind 算 blocked；默认 `custom` / `select` / `confirm` / `input` / `editor`。
- `bridge.enabled: false` 或 `blockedOn: []` = 不上报。
- `label` 取 `title`，没有则取 `kind`；herdr 集成把它作为 blocked message。
- 不依赖第三方 ask 事件；子进程即使没有 `subagent` 工具，也照常上报。
- 配置错误按第 1 节处理。
