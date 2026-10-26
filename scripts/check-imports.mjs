/**
 * docs/ARCHITECTURE.md §2 的可执行版本：依赖方向边表 + 单一出口。
 * 规则改了先改 ARCHITECTURE.md，再改这里的 EDGES / SINGLE_IMPORT；本脚本只校验源码，不比对文档。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** 允许的跨模块边：模块 -> 它可以直接 import 的模块（同模块内部不查）。 */
const EDGES = {
  ".": ["config", "extension", "herdr", "profile", "session"],
  config: ["config"],
  extension: ["config", "extension", "profile", "subagent", "herdr", "session"],
  subagent: ["config", "subagent", "profile", "herdr", "session"],
  profile: ["profile"],
  herdr: ["herdr"],
  session: ["session"],
};

/** 只允许出现在指定位置的依赖；typeOnlyIn 里的文件必须写成 `import type`。 */
const SINGLE_IMPORT = [
  {
    specifier: /^@earendil-works\/pi-coding-agent$/,
    only: ["src/index.ts", "src/extension/index.ts", "src/profile/index.ts"],
    typeOnlyIn: ["src/index.ts", "src/extension/index.ts"],
  },
  { specifier: /^typebox$/, only: ["src/extension/index.ts"] },
  { specifier: /^node:child_process$/, only: ["src/herdr/index.ts"] },
  {
    specifier: /^node:fs(\/|$)/,
    only: ["src/config/index.ts", "src/profile/index.ts", "src/session/index.ts", "src/subagent/index.ts"],
  },
  {
    specifier: /^node:(path|os|crypto)$/,
    only: ["src/config/index.ts", "src/profile/index.ts", "src/subagent/index.ts"],
  },
  {
    specifier: /^\.\.\/(config|herdr|profile|session)\/index\.ts$/,
    only: ["src/extension/index.ts", "src/subagent/index.ts"],
    typeOnlyIn: ["src/extension/index.ts"],
  },
];

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".ts")) files.push(relative(".", path).replaceAll("\\", "/"));
  }
}
walk("src");

/** 把相对导入按文件所在目录解析成仓库内 POSIX 路径，只用来判断归属模块。 */
function resolveSpec(file, spec) {
  const segments = [];
  const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  for (const segment of `${base}/${spec}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

const moduleOf = (path) => {
  const segments = path.split("/");
  return segments[0] === "src" && segments.length > 2 ? segments[1] : ".";
};

const failures = [];
for (const file of files.sort()) {
  const source = readFileSync(file, "utf-8");
  for (const [, typeOnly, spec] of source.matchAll(/^import\s+(type\s+)?(?:[\w*{}\s,$]+from\s+)?["']([^"']+)["']/gm)) {
    for (const rule of SINGLE_IMPORT) {
      if (!rule.specifier.test(spec)) continue;
      if (!rule.only.some((allowed) => file === allowed || file.startsWith(allowed))) {
        failures.push(`${file}: ${spec} is only allowed in ${rule.only.join(", ")}`);
      } else if (typeOnly === undefined && rule.typeOnlyIn?.includes(file)) {
        failures.push(`${file}: ${spec} must be import type`);
      }
    }
    if (!spec.startsWith(".")) continue;
    const from = moduleOf(file);
    const to = moduleOf(resolveSpec(file, spec));
    if (to === from || EDGES[from]?.includes(to)) continue;
    failures.push(`${file}: depends on ${to}/ (not allowed from ${from}/)`);
  }
}

if (failures.length > 0) {
  console.error("Import graph violates docs/ARCHITECTURE.md §2:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`ok: ${files.length} files`);
