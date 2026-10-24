# M0 E2E 记录（归档）

> 历史记录，不再更新。当前 runbook 见 [e2e/herdr.md](../../e2e/herdr.md)。

## T07 正常路径


环境：herdr 0.9.5、pi 1.4.0、Windows；命名 session `t07probe`。隔离目录 `$T07ROOT\agent` 复制 auth、最小 settings；server 以 `PI_CODING_AGENT_DIR=$T07ROOT\agent` 启动，子 tab 继承。父进程：

~~~powershell
$T07ROOT = "C:\Users\CHARLE~1\AppData\Local\Temp\t07e2e.E7X4UT"
pi --no-extensions -e src/index.ts --no-skills --no-prompt-templates --no-context-files --no-mcp --tools subagent --session "$T07ROOT\agent\parent.jsonl"
~~~

正常路径（AC2）：在父 pane 发送只读任务；工具返回

~~~json
{"state":"running","name":"worker-1","paneId":"w1:p6","sessionFile":"C:\\Users\\Charles Liu\\AppData\\Local\\Temp\\pi-herdr-subagents-lite\\1792755596863-ee4147b7-babc-4e05-b240-1fde81fcbaa3\\session-1.jsonl"}
~~~

新 tab `worker-1`（`w1:t6`）出现子 pi；父 pane 收到一条 `[subagent worker-1] done`，结果首行 `First markdown heading: # pi-herdr-subagents-lite`；随后 `tab list` 无 `w1:t6`，`agent list` 无 `worker-1`。子 session 的 tool 面只有 read/bash/edit/write，未加载旧 `pi-herdr-subagents` 或 ask。

真实 name_taken（AC2 附带）：预占 `worker-1` 后运行。herdr 原始错误：

~~~json
{"error":{"code":"agent_name_taken","message":"agent name tester2 is already used; ..."}}
~~~

适配器归一为 `name_taken` 后，subagent 重命名 tab 并以 `worker-2` 重试成功：返回 `{"state":"running","name":"worker-2","paneId":"w1:pB","sessionFile":"C:\\Users\\Charles Liu\\AppData\\Local\\Temp\\pi-herdr-subagents-lite\\1792755775059-e8851f11-3204-4388-b7c9-8fc59a073aca\\session-1.jsonl"}`，done 后 tab 关闭。

反问（AC3）：隔离环境只加 ask 包（未加旧 subagent）；该 run 的 sessionFile 是 `C:\Users\Charles Liu\AppData\Local\Temp\pi-herdr-subagents-lite\1792756464378-c7639a9f-7cd1-4fec-9429-bb261a46266b\session-1.jsonl`。派发要求子代理提问的任务；子 pane `w1:pG` 出现 `Which file should I read?`，父 pane 等待 18s 无转发、无 answer、无 unknown。在子 pane 按 Enter 选择 README 后，父 pane 只收到一条：

~~~text
[subagent worker-1] done

Asked once; you chose README.md.
First markdown heading: # pi-herdr-subagents-lite
~~~

随后子 tab 关闭，`agent list` 无 worker-1；父 session 无 `subagent_question`/answer 消息。E2E 暴露并修复：herdr 在 ask 弹窗期间报 `agent_status=done` + `completion_seq>0`，旧逻辑会读不到最终文本而投 `unknown (no_result)`；现在 SessionReader 返回 `{text,pendingToolCall}`，最后一条 assistant 仍带 toolCall 时继续轮询。

清理：`herdr --session t07probe server stop`、`herdr session delete t07probe`、删除 `$T07ROOT` 与对应 `/tmp/pi-herdr-subagents-lite` run root；全局配置未改。


## T08 失败路径


环境：herdr 0.9.5、pi 1.4.0、Windows；命名 session `t08probe`；隔离 agent dir `C:\Users\CHARLE~1\AppData\Local\Temp\t08e2e.4olWUR\agent`（本次实际路径，已按 AC5 删除）。server 以该 `PI_CODING_AGENT_DIR` 启动，父/子 pane 继承。

本次实际 agent 名：AC2 `parent2`、AC3 `parent3`、AC4 `parent5`；复跑沿用这组名字，session 文件见下表。

### 复跑

在 git-bash 的仓库根执行。以下 setup 必须在启动 server 前 export `PI_CODING_AGENT_DIR`：

~~~bash
herdr --session t08probe server stop >/dev/null 2>&1 || true
herdr session delete t08probe >/dev/null 2>&1 || true
T08ROOT=$(mktemp -d /tmp/t08e2e.XXXXXX)
AGENT_DIR="$T08ROOT/agent"
export PI_CODING_AGENT_DIR="$(cygpath -w "$AGENT_DIR")"
mkdir -p "$AGENT_DIR/sessions"
cp ~/.pi/agent/auth.json "$AGENT_DIR/auth.json"
cat > "$AGENT_DIR/settings.json" <<'JSON'
{"defaultProvider":"opencode-go","defaultModel":"deepseek-v4.1-flash","defaultThinkingLevel":"off","defaultProjectTrust":"always"}
JSON
cat > "$AGENT_DIR/keybindings.json" <<'JSON'
{"app.session.new":"f12"}
JSON
nohup herdr --session t08probe server >"$T08ROOT/server.log" 2>&1 &
sleep 2
PANE_ID=$(herdr --session t08probe workspace create --label t08ws --cwd "$PWD" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.root_pane.pane_id))')
test -n "$PANE_ID"
ENTRY=$(cygpath -m "$PWD/src/index.ts")
~~~

父 pi 的 agent 名与 session 文件（每个场景一个；从第二个场景起先 `herdr --session t08probe tab create --workspace w1 --cwd "$PWD" --no-focus`，用同样方式取新的 `$PANE_ID`）：

| 场景 | `PARENT` | `SESSION` |
|---|---|---|
| AC2 | `parent2` | `$AGENT_DIR/sessions/ac2-parent.jsonl` |
| AC3 | `parent3` | `$AGENT_DIR/sessions/ac3-parent.jsonl` |
| AC4 | `parent5` | `$AGENT_DIR/sessions/parent5.jsonl` |

AC4 的 `parent5.jsonl` 只是初始 session；`/new` 后 pi 另建时间戳 session，后续检查用 `ls -t` 取最新。

~~~bash
PARENT=parent2
SESSION="$AGENT_DIR/sessions/ac2-parent.jsonl"
herdr --session t08probe agent start "$PARENT" --kind pi --pane "$PANE_ID" --timeout 30000 -- \
  --no-extensions -e "$ENTRY" --no-skills --no-prompt-templates \
  --no-context-files --no-mcp --tools subagent --session "$(cygpath -w "$SESSION")"
~~~

> 父 pi 用 `--tools subagent` 只留 subagent；child 用 `settings.json` 的默认工具。`-e` 用绝对路径，pane 的 cwd 是 workspace 的 cwd。

场景操作：

~~~bash
# AC2：同一回合 5 个长任务
herdr --session t08probe agent prompt parent2 "Call subagent 5 times in one turn. Each task: run 'sleep 300' then answer AC2-ONE..FIVE. Do not wait between calls."
herdr --session t08probe tab list

# AC3：从 tab/pane list 取 worker-1 的 pane（本次 w1:pA），杀子 pi
herdr --session t08probe agent prompt parent3 "Call subagent once: run 'sleep 300' then answer AC3."
WORKER_TAB=$(herdr --session t08probe tab list \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).result.tabs.find(t=>t.label==="worker-1");console.log(t?.tab_id ?? "")})')
test -n "$WORKER_TAB"
WORKER_PANE=$(herdr --session t08probe pane list --workspace w1 \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).result.panes.find(p=>p.tab_id===process.argv[1]);console.log(p?.pane_id ?? "")})' "$WORKER_TAB")
test -n "$WORKER_PANE"
PID=$(herdr --session t08probe pane process-info --pane "$WORKER_PANE" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).result.process_info.foreground_processes.find(p=>p.argv0.endsWith("pi.exe"));console.log(f?.pid ?? "")})')
test -n "$PID"
taskkill //F //PID "$PID"
herdr --session t08probe tab list

# AC4：先 f12 新建 session，派发长任务，再 f12 切换
herdr --session t08probe agent send-keys parent5 f12
herdr --session t08probe agent prompt parent5 "Call subagent once: run 'sleep 120' then answer AC4-WORKER."
herdr --session t08probe agent send-keys parent5 f12
herdr --session t08probe agent prompt parent5 "Reply with exactly READY-NEW and call no tools."
NEW_SESSION=$(ls -t "$AGENT_DIR/sessions" | head -1)
rg -c '"customType":"subagent_result"' "$AGENT_DIR/sessions/$NEW_SESSION" || true
~~~

清理（先关父 tab，再关 worker tab，避免父收到 unknown 后补跑；tab 按 `tab list` 的 label 过滤）：

~~~bash
for TAB_ID in $(herdr --session t08probe tab list \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.tabs.filter(t=>t.label.startsWith("parent")).map(t=>t.tab_id).join(" ")))'); do
  herdr --session t08probe tab close "$TAB_ID"
done
for TAB_ID in $(herdr --session t08probe tab list \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.tabs.filter(t=>t.label.startsWith("worker-")).map(t=>t.tab_id).join(" ")))'); do
  herdr --session t08probe tab close "$TAB_ID"
done
herdr --session t08probe server stop
herdr session delete t08probe
rm -rf "$T08ROOT"
~~~

> run root 不在这里统一删：父 pane 的 subagent 结果里有 `sessionFile`（`/tmp/pi-herdr-subagents-lite/` 下某个 run 的 `session-N.jsonl`），删除其上一层目录；本次是 4 个 run root。不要用 `*`，同机可能有其他 run。

### 修复：长任务启动超时

原启动链把 brief 作为 `agent start` 的最后一个 argv：child 立刻开始首轮时 `agent start` 不返回 `interactive_ready`，sleep 25 的任务让 `agent start` 在 30.154s 后超时并释放 name，父收到 `spawn_failed: timed out waiting for agent startup; pane w1:p2 was created`。改成 `agent start` 只带 `--session`，等 idle 后 `agent prompt` 投递 brief 路径；`src/herdr/index.ts` 的 `startAgent` 顺序调整为两步。修复后 sleep 30 的任务约 10s 返回 running，30s 后投递 done。

### AC2 并发

父一次回合内调 5 次 run，task 都是 `sleep 300` 后回答 AC2-ONE..FIVE。4 条返回 running（worker-1..4），第 5 条：

~~~text
max_concurrent: already running worker-1, worker-2, worker-3, worker-4; wait for a result or close one
~~~

同时 `herdr tab list` 只有 4 个 worker tab（worker-1、worker-2、worker-3、worker-4），没有 worker-5。之后关闭这 4 个 tab，AC2 的父 agent `parent2`（见上表）在清理阶段自行补跑 worker-5；这是清理的副作用，与本 AC 无关，已一并关闭。

### AC3 unknown

父 prompt 一次 `sleep 300`；worker-1 进入 working 后，`herdr pane process-info --pane w1:pA` 取到 pi.exe 的 PID 13572，`taskkill //F //PID 13572`。父会话收到一条：

~~~text
[subagent worker-1] unknown (agent_missing)

Session: C:\Users\Charles Liu\AppData\Local\Temp\pi-herdr-subagents-lite\1792758709262-4fc3a918-f7f4-4ded-aced-2775bcd1d725\session-1.jsonl
~~~

`herdr agent get worker-1` 返回 `agent_not_found`；`tab list` 仍有 `w1:tA worker-1`，未 close。

### AC4 父 /new

隔离的 `keybindings.json` 只把 `app.session.new` 绑到 `f12`；先在空会话按一次 `f12` 验证键位，pane 显示 `✓ New session started`，父进入新会话 `2026-10-23T12-37-47-167Z_01a168c4-721f-75dd-b78d-beea7cd7526a.jsonl`（复跑时用 `ls -t "$AGENT_DIR/sessions"` 取最新）。在这个会话里 prompt 一次 `sleep 120`，确认 worker-1 working，再用 `herdr agent send-keys parent5 f12` 执行 /new；新 session 文件为 `2026-10-23T12-38-46-589Z_01a168c5-5a3c-75dd-b78d-beec1c4e9f8b.jsonl`。向新会话发 `Reply with exactly READY-NEW`，新会话只有 system、user、assistant 三条；等旧 worker `agent_status=done` 后再查，新会话 `custom_message` 数为 0，没有 `subagent_result`。旧 tab `w1:tE worker-1` 仍在，清理时手工关闭。旧 session `2026-10-23T12-37-47-167Z_01a168c4-721f-75dd-b78d-beea7cd7526a.jsonl` 只有 running 的 toolResult，没有结果消息。

### AC5 清理

`herdr --session t08probe server stop`、`herdr session delete t08probe` 后 `herdr session list` 只剩 `default`。删除 `C:\Users\CHARLE~1\AppData\Local\Temp\t08e2e.4olWUR` 和本次 4 个 `/tmp/pi-herdr-subagents-lite` run root，`/tmp/pi-herdr-subagents-lite` 为空。全局 `~/.pi/agent/settings.json` mtime `2026-10-23 19:36:47`、`auth.json` mtime `16:30:44`，都早于本会话；全局 `keybindings.json` 未创建；`C:\Users\Charles Liu\AppData\Roaming\herdr\config.toml` mtime `2026-10-01 22:46`，未改。
