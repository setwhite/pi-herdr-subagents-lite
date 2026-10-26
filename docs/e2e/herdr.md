
# herdr 手工 E2E

当前回归 runbook：一个 `subagent` 工具、只有 `run`、profile 来自 `<agent-dir>/agents/*.md`、名字 `<profile>-<n>`、并发上限来自 config。真实 herdr CLI 不进自动化测试，这里是唯一的手工链路。

环境：Windows + git-bash、herdr 0.9.5、pi 1.4.0。使用隔离的 `PI_CODING_AGENT_DIR`，只复制真实 `auth.json`，不碰全局配置。

## 1. 起隔离环境

~~~bash
herdr --session herdr-e2e server stop >/dev/null 2>&1 || true
herdr session delete herdr-e2e >/dev/null 2>&1 || true

ROOT=$(mktemp -d /tmp/herdr-e2e.XXXXXX)
AGENT_DIR="$ROOT/agent"
export PI_CODING_AGENT_DIR="$(cygpath -w "$AGENT_DIR")"
mkdir -p "$AGENT_DIR/sessions"
cp ~/.pi/agent/auth.json "$AGENT_DIR/auth.json"

cat > "$AGENT_DIR/settings.json" <<'JSON'
{"defaultProvider":"opencode-go","defaultModel":"deepseek-v4.1-flash","defaultThinkingLevel":"off","defaultProjectTrust":"always"}
JSON
cat > "$AGENT_DIR/keybindings.json" <<'JSON'
{"app.session.new":"f12"}
JSON
mkdir -p "$AGENT_DIR/agents" "$AGENT_DIR/pi-herdr-subagents-lite"
cat > "$AGENT_DIR/agents/explore.md" <<'MD'
---
description: Explore the repo
---

Read files and answer questions about the repository.
MD
cat > "$AGENT_DIR/pi-herdr-subagents-lite/config.json" <<'JSON'
{"maxConcurrent":4}
JSON

nohup herdr --session herdr-e2e server >"$ROOT/server.log" 2>&1 &
sleep 2

PANE_ID=$(herdr --session herdr-e2e workspace create --label e2e --cwd "$PWD" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.root_pane.pane_id))')
test -n "$PANE_ID"
ENTRY=$(cygpath -m "$PWD/src/index.ts")
~~~

起父 pi：

~~~bash
PARENT=parent1
SESSION="$AGENT_DIR/sessions/parent1.jsonl"
herdr --session herdr-e2e agent start "$PARENT" --kind pi --pane "$PANE_ID" --timeout 30000 -- \
  --no-extensions -e "$ENTRY" --no-skills --no-prompt-templates \
  --no-context-files --no-mcp --tools subagent --session "$(cygpath -w "$SESSION")"
~~~

## 2. 正常路径

~~~bash
herdr --session herdr-e2e agent prompt parent1 \
  "Call subagent once with profile explore: read README.md and answer with its first heading. Do not wait for the result."
herdr --session herdr-e2e tab list
~~~

预期：

- 父会话先收到 `{"state":"running","name":"explore-1","paneId":"...","sessionFile":"..."}`，其中 sessionFile 是 `$AGENT_DIR/pi-herdr-subagents-lite/sessions/explore-1-<runId>.jsonl`，brief 与身份文件是同前缀的兄弟文件；
- 出现一个新的 `explore-1` tab，里面有子 pi，pane 标签是任务首行；
- 父会话收到一条 `[subagent explore-1] done`，内容含 README 的一级标题；
- 结果投递后 worker tab 关闭，`agent list` 里没有 `explore-1`。

反问验证（如果子环境有 `ask_user_question`）：派一个会提问的短任务；问题只出现在子 pane，父会话不转发、不回答；人在子 pane 回答后，父会话只收到最终 `done`。

## 3. 并发上限

~~~bash
herdr --session herdr-e2e agent prompt parent1 \
  "Call subagent 5 times in one turn with profile explore. Each task: run 'sleep 30' then answer ONE..FIVE. Do not wait between calls."
herdr --session herdr-e2e tab list
~~~

预期：前 4 条返回 `running`（`explore-1`…`explore-4`）；第 5 条 `isError`，文本以 `max_concurrent:` 开头并列出 4 个 live 名称；`tab list` 只有 4 个 `explore-*` tab。

## 4. 子进程被杀

新建一个父 tab，避免和上一组 worker 混在一起：

~~~bash
PANE2=$(herdr --session herdr-e2e tab create --workspace w1 --cwd "$PWD" --no-focus \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.root_pane.pane_id))')
PARENT=parent2
SESSION="$AGENT_DIR/sessions/parent2.jsonl"
herdr --session herdr-e2e agent start "$PARENT" --kind pi --pane "$PANE2" --timeout 30000 -- \
  --no-extensions -e "$ENTRY" --no-skills --no-prompt-templates \
  --no-context-files --no-mcp --tools subagent --session "$(cygpath -w "$SESSION")"

herdr --session herdr-e2e agent prompt parent2 \
  "Call subagent once with profile explore: run 'sleep 60' then answer KILL. Do not wait."
herdr --session herdr-e2e tab list
~~~

从 `tab list` 取刚出现的 `explore-*` tab，再取 pane 与子 pi 的 PID：

~~~bash
WORKER_TAB=w1:tX   # 换成实际 tab_id
WORKER_PANE=$(herdr --session herdr-e2e pane list --workspace w1 \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).result.panes.find(p=>p.tab_id===process.argv[1]);console.log(p?.pane_id ?? "")})' "$WORKER_TAB")
PID=$(herdr --session herdr-e2e pane process-info --pane "$WORKER_PANE" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).result.process_info.foreground_processes.find(p=>p.argv0.endsWith("pi.exe"));console.log(f?.pid ?? "")})')
test -n "$PID"
taskkill //F //PID "$PID"
herdr --session herdr-e2e tab list
~~~

预期：父会话收到一条 `[subagent explore-N] unknown (agent_missing)`，含 `Session:` 路径；worker tab 仍在，不自动关闭。

## 5. 父 /new

~~~bash
herdr --session herdr-e2e agent send-keys parent2 f12
herdr --session herdr-e2e agent prompt parent2 "Reply with exactly READY-NEW and call no tools."
NEW_SESSION=$(ls -t "$AGENT_DIR/sessions" | head -1)
rg -c '"customType":"subagent_result"' "$AGENT_DIR/sessions/$NEW_SESSION" || true
~~~

预期：新会话只响应 `READY-NEW`，没有 `subagent_result`；旧 worker 不被认领，旧 tab 留人工关闭。

## 6. 清理

~~~bash
herdr --session herdr-e2e server stop
herdr session delete herdr-e2e
rm -rf "$ROOT"
~~~
