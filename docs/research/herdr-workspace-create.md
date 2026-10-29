# herdr workspace create 实测

研究记录；当前契约见 [v1 契约](../specs/0001-v1-contract.md)，决策见 [0022](../decisions/0022-tab-placement.md)。

日期 2026-10-29。环境：herdr 0.9.5，Windows + git-bash，protocol 22。在隔离 named session `probe-t32` 里跑，跑完 `server stop` 与 `session delete`。

## 命令与输出

~~~bash
herdr --session probe-t32 workspace create --cwd "$PWD" --label probe --no-focus
~~~

省略 `scroll`、`terminal_id`、`revision` 字段：

~~~json
{"id":"cli:workspace:create","result":{
  "workspace":{"active_tab_id":"w1:t1","label":"probe","number":1,"pane_count":1,"tab_count":1,"workspace_id":"w1"},
  "tab":{"focused":true,"label":"1","number":1,"pane_count":1,"tab_id":"w1:t1","workspace_id":"w1"},
  "root_pane":{"cwd":"C:\\Users\\Charles Liu\\Desktop\\herdr探索\\","focused":true,"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1"}
}}
~~~

~~~bash
herdr --session probe-t32 tab create --workspace w1 --cwd "$PWD" --label probe-tab --no-focus
~~~

~~~json
{"id":"cli:tab:create","result":{
  "tab":{"focused":false,"label":"probe-tab","number":2,"pane_count":1,"tab_id":"w1:t2","workspace_id":"w1"},
  "root_pane":{"cwd":"C:\\Users\\Charles Liu\\Desktop\\herdr探索\\","focused":false,"pane_id":"w1:p2","tab_id":"w1:t2","workspace_id":"w1"}
}}
~~~

## 结论

1. `workspace create` 一次建 workspace、初始 tab 与 root pane；workspace id 在 `result.workspace.workspace_id`。
2. 初始 tab 的 label 是序号（`"1"`），不是 `--label` 的值；`--label` 只设 workspace label。
3. `tab create --workspace <id>` 在该 workspace 追加 tab，tab 编号接着 workspace 内已有 tab（`w1:t2`）。
4. `--no-focus` 对 workspace 与 tab 都生效：`tab create` 返回的 root pane `focused: false`。
