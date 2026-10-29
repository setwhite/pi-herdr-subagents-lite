# pi-herdr-subagents-lite

English | [简体中文](README.zh-CN.md)

A pi extension that runs subagents in herdr panes. One tool, two actions: `run` starts a subagent, `send` continues it, and results come back to the parent session asynchronously.

Status: experimental. The v1 contract is settled, but cross-version compatibility is not promised. Exact behavior lives in the [v1 contract](docs/specs/0001-v1-contract.md). Project docs are in Chinese.

## Features

- **Separate process, human takeover**: a subagent is its own pi process in a herdr pane. If its cwd equals the parent's, it opens a new tab in the same workspace; otherwise it creates a new workspace. You can switch into that pane and take over at any time.
- **Two profile layers**: Markdown + frontmatter. Global `<agent-dir>/pi-herdr-subagents-lite/profiles/`, project `.pi/pi-herdr-subagents-lite/profiles/`; the same name in the project overrides the global one.
- **Async delivery**: `run` returns immediately. When a child settles, its result arrives as a `subagent_result` message; results that land within `aggregateWindowMs` of each other are merged into one message.
- **Oversize results go to disk**: a result longer than `maxResultChars` is written whole to an artifact, and the message keeps a truncated head plus the file path.
- **Questions stay with the human**: when a child opens a prompt, the parent gets a `subagent_question` message and `bridge` emits `herdr:blocked`. The human answers in the child pane; the parent model never relays the answer.
- **Controlled teardown**: the profile's `auto-exit` decides whether a child shuts itself down and closes its tab; `closeChildrenOn` decides which parent shutdown reasons close child tabs.
- **No nesting by default**: child tool sets drop this tool. To nest, name the tool explicitly in the profile's `tools`.
- **Not a sandbox**: the profile decides which tools a child gets. The extension does not restrict writes.

## Requirements

| Dependency | Notes |
|---|---|
| herdr | Verified on `0.9.5`. The parent session must run inside a herdr pane, otherwise calls fail with `not_in_herdr`. |
| pi | Verified on `1.4.0`. |
| Node | `>= 22.19`. |

## Install

Pick one source, then restart pi.

**npm**

```bash
pi install npm:pi-herdr-subagents-lite
```

**git**

```bash
pi install git:github.com/setwhite/pi-herdr-subagents-lite
```

**Local checkout**

```bash
pi install /path/to/pi-herdr-subagents-lite          # written to settings; children load it too
pi -e /path/to/pi-herdr-subagents-lite/src/index.ts  # this process only
```

`pi install` writes your personal settings (`<agent-dir>/settings.json`) and applies to every project. **Do not pass `-l`**: `-l` writes project settings only, so children started in another workspace never load this package, and both the inbox pump and the bridge stop working. `pi -e` is single-process too: children do not get this extension.

Upgrade with `pi update --extensions`, remove with `pi remove <source>`. After installing, start pi in a herdr pane; the tool list should show `subagent` (or your configured `toolName`).

## Quick start

1. Open a pane in herdr and start `pi`.
2. Write a profile (next section). The file name without `.md` is the name `run` takes.
3. Ask the model to call the tool with arguments like:

```json
{"action":"run","profile":"explore","task":"Read README.md and answer with its first heading."}
```

4. It returns `{"state":"running",...}`. The child runs in its own tab, and a `[subagent explore-1] done` message arrives later. Do not wait for the result in the same turn.

Continue a child:

```json
{"action":"send","name":"explore-1","message":"Also check the Windows branch."}
```

## Profile

Global profiles live in `<agent-dir>/pi-herdr-subagents-lite/profiles/*.md`, project profiles in `.pi/pi-herdr-subagents-lite/profiles/*.md` (read only after the project is trusted); the same name in the project overrides the global one.

```markdown
---
# Display name, shown only in the profile list of the tool guidelines; run takes the file name
name: Explore
description: Read-only research: read code, answer questions, change nothing

# Omit model / thinking to inherit them from the parent session; model uses pi's provider/model form
# model: provider/model
thinking: low

# Plain names = strict allowlist; +name / -name adds or removes from the default set, never mix both
# Omitted = pi defaults minus this tool (nesting off); empty string = empty allowlist
tools: read, bash

# Omitted = pi discovery; "" = load no skills; a list = load only the listed ones
skills: ""

# append (default) / replace: body is appended to or replaces the system prompt; task: body is the task text, no identity file
system-prompt: append

# Child shuts down and its tab closes when the task settles; it stays while a prompt is open or inbox messages are pending
auto-exit: true

# true = hidden from the guidelines; an explicit run still works
disable-model-invocation: false
---

You are a read-only explorer. Answer with file paths and line numbers.
```

Field meanings and defaults: [contract section 2](docs/specs/0001-v1-contract.md#2-profile). A profile that fails to parse stays out of the list; `run` on a broken profile returns `profile_invalid` with the file, field, and reason.

### Bundled example

On install the extension writes one example to `<agent-dir>/pi-herdr-subagents-lite/profiles/examples/domain.md`. It writes only when the file is missing, so your edits are never overwritten. Loading reads `profiles/*.md` only, so the example stays inert until you copy it one level up:

```bash
cd ~/.pi/agent/pi-herdr-subagents-lite/profiles
cp examples/domain.md domain.md
```

`domain` is a general domain worker: `disable-model-invocation: true` keeps it out of the tool guidelines, so only an explicit run uses it; `auto-exit: true` closes its tab when the work is done. Use it to hand work in another domain to a subagent that starts with a fresh context.

## Configuration

Path: `<agent-dir>/pi-herdr-subagents-lite/config.json`. `<agent-dir>` defaults to `~/.pi/agent` and can be moved with `PI_CODING_AGENT_DIR`. There is exactly one global config; project config is not read.

### Minimal config

A missing file means all defaults. To change one value, write only that value:

```json
{
  "maxConcurrent": 4
}
```

### Full config

Every key is listed below with its default value. The config must be strict JSON: an unknown key, a wrong type, or a bad enum makes the extension fail to load and pi exits with the field named. The `//` lines are comments; delete them before use.

```jsonc
{
  // Only gates tool registration; the bridge is controlled by bridge.enabled; running children are unaffected
  "enabled": true,

  // Tool name as the model sees it; must match ^[a-z][a-z0-9_]{0,31}$
  "toolName": "subagent",

  // herdr executable. Resolved from PATH by default; an absolute path pins a version
  "herdrBin": "herdr",

  // Live children per parent session. A child with auto-exit false keeps its slot after it settles
  "maxConcurrent": 16,

  // Character cap per result (1024-1048576). Beyond it the full text goes to an artifact and the message keeps the truncated head and path
  "maxResultChars": 16384,

  // Aggregation window in ms (0-10000). Results inside the window merge into one message; 0 = deliver each immediately
  "aggregateWindowMs": 500,

  // Parent shutdown reasons that close its child tabs. Empty = never close
  // Allowed: new / resume / fork / quit / reload
  "closeChildrenOn": [],

  // Child-side inbox polling interval in ms (50-5000)
  "inboxPollMs": 250,

  // Parent-side herdr agent list polling interval in ms (100-60000). Larger saves processes, smaller spots finished children sooner
  "pollIntervalMs": 1000,

  // Override tool text. Omitted keys keep the built-in text; the values below are placeholders, drop the whole block if unused
  "prompts": {
    "description": "One line about what this tool does",
    "snippet": "One line shown in Available tools",
    // Replaces the built-in guidelines; keep a line containing {{profiles}} to keep the profile list
    "guidelines": ["Do not wait for a result in this turn.", "Available profiles:\n{{profiles}}"]
  },

  // bridge: turns pi prompt events into herdr:blocked for native notifications
  "bridge": {
    "enabled": true,
    // Which prompt kinds count as blocked; default all
    "blockedOn": ["custom", "select", "confirm", "input", "editor"]
  }
}
```

Out-of-range numbers are not errors; they are silently clamped to the boundary. The config is read once, so restart pi after editing.

## Reference projects

The design is based on these projects. Thank you.

| Project | Borrowed |
|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi) | Extension API, package layout, official examples |
| [fyang93/pi-herdr-subagents](https://github.com/fyang93/pi-herdr-subagents) | Profile field shapes; integration tests on an isolated herdr session |
| [modem-dev/pi-herdr-subagents](https://github.com/modem-dev/pi-herdr-subagents) | herdr launch and lifecycle; derived end states |
| [purboo/pi-durable-subagents](https://github.com/purboo/pi-durable-subagents) | Async delivery, idempotency, and report-once message design |

## Docs

All docs are in Chinese.

| Doc | Content |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Module boundaries, dependency direction, test seams |
| [v1 contract](docs/specs/0001-v1-contract.md) | Config, profile, tool, send, results, bridge |
| [GLOSSARY](docs/GLOSSARY.md) | Terms |
| [Decision index](docs/decisions/README.md) | One decision per file |
| [herdr recovery and status](docs/research/herdr-恢复与状态实测.md) | Observed herdr behavior |
| [herdr agent list](docs/research/herdr-agent-list.md) | `agent list` output and field conclusions |
| [herdr workspace create](docs/research/herdr-workspace-create.md) | Fields of `workspace create` / `tab create --workspace` |
| [pi install and pack output](docs/research/pi-install-pack.md) | A tarball is not a pi package source; verify locally with npm layout |

## Development

| Command | Purpose |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm check` | Everything before a commit: lint → import boundaries → types → unit tests |
| `pnpm lint` | biome check |
| `pnpm check:imports` | Dependency direction check |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | Real E2E: real herdr plus real pi child processes |

Enable the commit hook once and `pnpm check` runs on every commit:

```bash
git config core.hooksPath .githooks
```

E2E is not part of `pnpm check`; run it on its own. It starts an isolated herdr session and agent directory, and skips the whole suite with a reason when herdr, pi, or `auth.json` is missing.

| Variable | Effect |
|---|---|
| `PI_E2E_MODEL=provider/model` | Use another model for E2E |
| `PI_E2E_KEEP=1` | Keep temp directories for later inspection |

## License

MIT, see [LICENSE](LICENSE).
