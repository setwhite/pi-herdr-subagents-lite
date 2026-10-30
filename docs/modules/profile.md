# profile

`loadProfiles` 读全局与受信项目的 `profiles/*.md`，同名项目覆盖全局；坏字段只跳过该 profile，返回 `{ profiles, problems }`，模块自己不抛错（DEC-0042）。

`seedExampleProfile` 在文件缺失时写一份示例到 `profiles/examples/domain.md`，已存在就不动；加载只看 `profiles/*.md`，示例不会自动生效（DEC-0057）。
