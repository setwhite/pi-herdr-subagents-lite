# config

`loadConfig` 读一次 `<data-dir>/config.json`：不存在取默认值，数值越界静默 clamp，未知键、类型错、枚举错合并成一条带路径与字段名的错误；无效时不注册工具（D37）。
