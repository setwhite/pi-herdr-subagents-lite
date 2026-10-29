# profile

`loadProfiles` 读全局与受信项目的 `profiles/*.md`，同名项目覆盖全局；坏字段只跳过该 profile，返回 `{ profiles, problems }`，模块自己不抛错（0042）。
