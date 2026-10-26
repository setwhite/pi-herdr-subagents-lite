# D10 子代理 cwd 默认继承父

子代理 cwd 默认继承父会话 cwd；profile 显式写了 cwd 才切换，相对路径按父 cwd 解析。

依据：子进程按目录拾取 `.pi`、`AGENTS.md`、skills；默认跟随父会话最不意外。
