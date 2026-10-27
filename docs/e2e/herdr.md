
# herdr 手工 E2E

当前回归 runbook：一个 `subagent` 工具，`run` / `send`；子进程加载本包轮询 inbox；profile 来自 `<agent-dir>/pi-herdr-subagents-lite/profiles/*.md`、名字 `<profile>-<n>`、并发上限来自 config。真实 herdr CLI 不进自动化测试，这里是唯一的手工链路。

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
mkdir -p "$AGENT_DIR/pi-herdr-subagents-lite/profiles"
cat > "$AGENT_DIR/pi-herdr-subagents-lite/profiles/explore.md" <<'MD'
---
description: Explore the repo
---

Read files and answer questions about the repository.
MD
cat > "$AGENT_DIR/pi-herdr-subagents-lite/config.json" <<'JSON'
{"maxConcurrent":4,"inboxPollMs":100}
JSON

# 父、子 pi 都从隔离 agent 目录加载本包；local package 不复制。
pi install "$(cygpath -w "$PWD")" --no-approve

nohup herdr --session herdr-e2e server >"$ROOT/server.log" 2>&1 &
sleep 2

PANE_ID=$(herdr --session herdr-e2e workspace create --label e2e --cwd "$PWD" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.root_pane.pane_id))')
test -n "$PANE_ID"
~~~

起父 pi：

~~~bash
PARENT=parent1
SESSION="$AGENT_DIR/sessions/parent1.jsonl"
herdr --session herdr-e2e agent start "$PARENT" --kind pi --pane "$PANE_ID" --timeout 30000 -- \
  --no-skills --no-prompt-templates \
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
- 结果投递后 worker tab 仍在（`auto-exit` 默认 false），`agent list` 里仍有 `explore-1`，状态 idle；此时 `send` 直接写 inbox，不重启。
- 自退变体：profile 加 `auto-exit: true` 重跑本节，done 后 tab 消失、`agent list` 里没有 `explore-1`。

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
  --no-skills --no-prompt-templates \
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

预期：父会话收到一条 `[subagent explore-N] unknown (pane_exited)`，含 `Session:` 路径；worker tab 仍在，不自动关闭。

## 5. 父 /new

~~~bash
herdr --session herdr-e2e agent send-keys parent2 f12
herdr --session herdr-e2e agent prompt parent2 "Reply with exactly READY-NEW and call no tools."
NEW_SESSION=$(ls -t "$AGENT_DIR/sessions" | head -1)
rg -c '"customType":"subagent_result"' "$AGENT_DIR/sessions/$NEW_SESSION" || true
~~~

预期：新会话只响应 `READY-NEW`，没有 `subagent_result`；旧 worker 不被认领，旧 tab 留人工关闭。

## 6. M2：send / 续聊

前置：第 1 节已完成，父、子 pi 都从隔离 agent 目录加载本包。未完成则先执行第 1 节。

### 6.1 live 子代理 send

~~~bash
PARENT=parent1
SESSION="$AGENT_DIR/sessions/parent1.jsonl"
RESULT_BEFORE=$(rg -c '"customType":"subagent_result"' "$SESSION" || echo 0)
RUN_BEFORE=$(rg -c '"state":"running"' "$SESSION" || echo 0)
SENT_BEFORE=$(rg -c '"state":"sent"' "$SESSION" || echo 0)

herdr --session herdr-e2e agent prompt parent1 \
  "Call subagent once with profile explore. The task is exactly: run the bash command 'sleep 30' then answer exactly FIRST. Do not wait for the result; end your turn immediately after the tool returns."

# 等本次 run 的 running 结果，取真实名字；不要假设 explore-1
until [ "$(rg -c '"state":"running"' "$SESSION" || echo 0)" -gt "$RUN_BEFORE" ]; do sleep 1; done
NAME=$(node -e 'const fs=require("fs");let name="";for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){try{const j=JSON.parse(l);const d=j.message?.details??j.details;if(d?.state==="running"&&d.name)name=d.name}catch{}}console.log(name)' "$SESSION")
test -n "$NAME"

# worker tab 出现后立即取 tab/pane；split 成两个 pane，验证多 pane 的 tab 不被关
WORKER_TAB=""
for i in $(seq 1 60); do
  WORKER_TAB=$(herdr --session herdr-e2e tab list \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).result.tabs.find(t=>t.label===process.argv[1]);console.log(t?.tab_id ?? "")})' "$NAME")
  if [ -n "$WORKER_TAB" ]; then break; fi
  sleep 0.5
done
test -n "$WORKER_TAB"
WORKER_PANE=$(herdr --session herdr-e2e pane list --workspace w1 \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).result.panes.find(p=>p.tab_id===process.argv[1]);console.log(p?.pane_id ?? "")})' "$WORKER_TAB")
test -n "$WORKER_PANE"
herdr --session herdr-e2e pane split --pane "$WORKER_PANE" --direction right --no-focus

# 等第一条 done（相对进入本节前的计数）；tab 仍在，pane_count 为 2
until [ "$(rg -c '"customType":"subagent_result"' "$SESSION" || echo 0)" -gt "$RESULT_BEFORE" ]; do sleep 1; done
rg -n '"customType":"subagent_result"' "$SESSION"
herdr --session herdr-e2e tab list

CHILD_SESSION=$(node -e 'const fs=require("fs");let file="";for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){try{const j=JSON.parse(l);const d=j.message?.details??j.details;if(d?.name===process.argv[2]&&d.sessionFile)file=d.sessionFile}catch{}}console.log(file)' "$SESSION" "$NAME")
wc -l "$CHILD_SESSION"

herdr --session herdr-e2e agent prompt parent1 \
  "Call the subagent tool exactly once with action send, name $NAME, and message exactly: Answer exactly SECOND and call no tools. Do not call it again. Do not call run. After the tool returns, end your turn."

until [ "$(rg -c '"state":"sent"' "$SESSION" || echo 0)" -gt "$SENT_BEFORE" ]; do sleep 1; done
until [ "$(rg -c '"customType":"subagent_result"' "$SESSION" || echo 0)" -gt "$((RESULT_BEFORE + 1))" ]; do sleep 1; done
rg -n '"state":"sent"|"customType":"subagent_result"' "$SESSION"
wc -l "$CHILD_SESSION"
herdr --session herdr-e2e tab list
~~~

预期：`NAME` 是本次新子代理的真实名字（从 `running` 结果取，可能是 `explore-2`、`explore-6` 等）；第一条 done 后该 tab 仍有 2 个 pane；send 返回 `{"state":"sent","name":"<NAME>"}`；父会话收到第二条 `done`，正常内容含 `SECOND`；`CHILD_SESSION` 是 `$NAME` 的子 session，路径不变，行数增加。若父模型在第一条 done 后自行插入一条 stand-down send，第二条可能是该回复；此时以“新增 `$NAME` 的 done 且行数增加”为准。

### 6.2 退出后重启

~~~bash
# 关掉整个 worker tab，模拟子代理退出、pane 已关
herdr --session herdr-e2e tab close "$WORKER_TAB"
sleep 1
herdr --session herdr-e2e tab list
herdr --session herdr-e2e agent list       # 不应再有 $NAME
herdr --session herdr-e2e pane list --workspace w1

RESTART_BEFORE=$(rg -c '"state":"restarted"' "$SESSION" || echo 0)
THIRD_BEFORE=$(rg -c '"customType":"subagent_result"' "$SESSION" || echo 0)

# 用慢消息，让 restarted 之后有时间抓 agent/pane 中间态
herdr --session herdr-e2e agent prompt parent1 \
  "Call the subagent tool exactly once with action send, name $NAME, and message exactly: run the bash command 'sleep 20' then answer exactly THIRD. Do not call it again. Do not call run. After the tool returns, end your turn."

until [ "$(rg -c '"state":"restarted"' "$SESSION" || echo 0)" -gt "$RESTART_BEFORE" ]; do sleep 1; done
rg -n '"state":"restarted"' "$SESSION"
herdr --session herdr-e2e agent list       # $NAME 重新出现，pane 是新的
herdr --session herdr-e2e pane list --workspace w1
herdr --session herdr-e2e tab list

until [ "$(rg -c '"customType":"subagent_result"' "$SESSION" || echo 0)" -gt "$THIRD_BEFORE" ]; do sleep 1; done
rg -n '"customType":"subagent_result"' "$SESSION"
~~~

预期：关 tab 后 `agent list` / `pane list` 没有 `$NAME`；send 返回 `{"state":"restarted","name":"$NAME","paneId":"<新 pane>"}`；`agent list` 重新出现 `$NAME`，`pane list` 有新的 pane；父会话收到第三条 `done`，内容含 `THIRD`。

## 7. 清理

~~~bash
herdr --session herdr-e2e server stop
herdr session delete herdr-e2e
rm -rf "$ROOT"
~~~
