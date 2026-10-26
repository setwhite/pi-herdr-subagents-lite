# D50 skills 三态

`skills` 省略 = pi 默认发现；空字符串或空列表 = `--no-skills`；非空列表 = `--no-skills` + 每项 `--skill`，只加载指定项。

依据：`--skill` 只追加；`--no-skills` 关闭发现；三态能表达继承、全禁、白名单。
