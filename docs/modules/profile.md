# profile

`loadProfiles` 读全局与受信项目的 `profiles/*.md`；profile 名取 frontmatter `name`（必填，非空），文件名不参与寻址。同一层同名全部不加载；跨层同名项目覆盖全局（DEC-0042、DEC-0058）。坏字段只跳过该 profile，返回 `{ profiles, problems }`，模块自己不抛错。

`seedExampleProfile` 在文件缺失时写一份示例到 `profiles/examples/domain.md`，已存在就不动；示例的 `name` 与文件名都是 `domain`。加载只看 `profiles/*.md`，示例不会自动生效（DEC-0057）。
