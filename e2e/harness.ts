// 真实 herdr + 真实 pi：每次运行自建 named session 与隔离 agent 目录，永不碰 default session 与 ~/.pi。
// 模型调用会花钱；缺 herdr、pi 或 auth.json 时整组跳过。
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_AGENT_DIR = join(homedir(), ".pi", "agent");
const README = "# E2E Project\n";

export interface Prereq {
  ok: boolean;
  reason?: string;
}

function runnable(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  if (process.platform !== "win32") {
    return true;
  }
  return /\.(exe|cmd|bat)$/i.test(path);
}

function findBin(names: string[]): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (runnable(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export const HERDR_BIN = process.env.HERDR_BIN ?? findBin(["herdr.exe", "herdr"]);
export const PI_BIN = process.env.PI_BIN ?? findBin(["pi.exe", "pi"]);

export function prereqs(): Prereq {
  if (HERDR_BIN === undefined) {
    return { ok: false, reason: "herdr not found on PATH (set HERDR_BIN)" };
  }
  if (PI_BIN === undefined) {
    return { ok: false, reason: "pi not found on PATH (set PI_BIN)" };
  }
  if (!existsSync(join(REAL_AGENT_DIR, "auth.json"))) {
    return { ok: false, reason: `no model auth (${join(REAL_AGENT_DIR, "auth.json")} missing)` };
  }
  return { ok: true };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

export async function waitFor<T>(
  fn: () => T | Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout after ${timeoutMs}ms: ${label}`);
    }
    await sleep(200);
  }
}

function run(
  bin: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      bin,
      args,
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: options.timeout ?? 60_000,
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          fail(new Error(`${bin} ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
          return;
        }
        done(stdout);
      },
    );
  });
}

function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("HERDR_")) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

export interface TabInfo {
  tab_id: string;
  label: string;
  pane_count: number;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
}

export interface AgentInfo {
  name?: string;
  pane_id: string;
  agent_status: string;
  completion_seq?: number;
}

export interface StartedRun {
  state: "running";
  name: string;
  paneId: string;
  sessionFile: string;
}

export interface SentMessage {
  state: "sent";
  name: string;
}

export interface RestartedRun {
  state: "restarted";
  name: string;
  paneId: string;
}

export interface ToolError {
  code: string;
}

interface ToolResult {
  text: string;
  isError: boolean;
}

export function entries(file: string): unknown[] {
  if (!existsSync(file)) {
    return [];
  }
  const out: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") {
      continue;
    }
    try {
      out.push(JSON.parse(text));
    } catch {
      // 半行：pi 正在写，下一拍再读。
    }
  }
  return out;
}

export function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((block) =>
      typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("");
}

function toolResults(file: string): ToolResult[] {
  const out: ToolResult[] = [];
  for (const entry of entries(file)) {
    const record = entry as { type?: string; message?: { role?: string; content?: unknown; isError?: unknown } };
    if (record.type !== "message" || record.message?.role !== "toolResult") {
      continue;
    }
    out.push({ text: textOf(record.message.content), isError: record.message.isError === true });
  }
  return out;
}

export function results<T>(file: string, state: string): T[] {
  const out: T[] = [];
  for (const result of toolResults(file)) {
    if (result.isError) {
      continue;
    }
    try {
      const parsed = JSON.parse(result.text) as { state?: string };
      if (parsed.state === state) {
        out.push(parsed as T);
      }
    } catch {
      // 非 JSON 的成功结果不是本工具。
    }
  }
  return out;
}

export function errors(file: string, code: string): string[] {
  return toolResults(file)
    .filter((result) => result.isError && result.text.startsWith(`${code}:`))
    .map((result) => result.text);
}

export function messages(file: string, customType: string): string[] {
  const out: string[] = [];
  for (const entry of entries(file)) {
    const record = entry as { type?: string; customType?: string; content?: unknown };
    if (record.type === "custom_message" && record.customType === customType) {
      out.push(textOf(record.content));
    }
  }
  return out;
}

export function killProcess(pid: number): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/F", "/PID", String(pid)], { windowsHide: true }, () => {});
    return;
  }
  process.kill(pid, "SIGKILL");
}

export class HerdrE2e {
  readonly root: string;
  readonly agentDir: string;
  readonly project: string;
  readonly sessionName: string;
  workspaceId = "";
  rootPaneId = "";
  private server: ChildProcess | undefined;
  private readonly env: NodeJS.ProcessEnv;

  private constructor(root: string, sessionName: string) {
    this.root = root;
    this.agentDir = join(root, "agent");
    this.project = join(root, "project");
    this.sessionName = sessionName;
    this.env = cleanEnv({ PI_CODING_AGENT_DIR: this.agentDir });
  }

  static async create(): Promise<HerdrE2e> {
    const state = prereqs();
    if (!state.ok) {
      throw new Error(`e2e prerequisites missing: ${state.reason}`);
    }
    const root = mkdtempSync(join(tmpdir(), "pi-herdr-e2e-"));
    const e2e = new HerdrE2e(root, `e2e-${process.pid}-${Date.now().toString(36)}`);
    await e2e.setup();
    return e2e;
  }

  private async setup(): Promise<void> {
    const bin = HERDR_BIN as string;
    const pi = PI_BIN as string;
    mkdirSync(join(this.agentDir, "sessions"), { recursive: true });
    mkdirSync(join(this.agentDir, "pi-herdr-subagents-lite", "profiles"), { recursive: true });
    mkdirSync(this.project, { recursive: true });
    writeFileSync(join(this.project, "README.md"), README);
    copyFileSync(join(REAL_AGENT_DIR, "auth.json"), join(this.agentDir, "auth.json"));
    this.writeSettings();
    this.writeConfig({ maxConcurrent: 16, inboxPollMs: 100, pollIntervalMs: 200 });
    writeFileSync(join(this.agentDir, "trust.json"), JSON.stringify({ [this.root]: true }));

    await run(pi, ["install", REPO, "--no-approve"], { env: this.env, cwd: this.root });

    this.server = spawn(bin, ["--session", this.sessionName, "server"], {
      detached: true,
      stdio: "ignore",
      env: this.env,
      windowsHide: true,
      cwd: this.root,
    });
    this.server.unref();

    const status = await waitFor(
      async () => {
        const text = await run(bin, ["--session", this.sessionName, "status", "server", "--json"], { env: this.env });
        const parsed = JSON.parse(text) as { running?: boolean; socket?: string };
        if (!parsed.socket?.includes(this.sessionName)) {
          throw new Error(`refusing to use socket ${parsed.socket}: not this session`);
        }
        return parsed.running === true ? parsed : null;
      },
      "herdr server to start",
      30_000,
    );
    if (!status.socket?.includes(this.sessionName)) {
      throw new Error(`unexpected socket: ${status.socket}`);
    }

    const created = (await this.call(["workspace", "create", "--label", "e2e", "--cwd", this.project])) as {
      root_pane: { pane_id: string };
      workspace: { workspace_id: string };
    };
    this.rootPaneId = created.root_pane.pane_id;
    this.workspaceId = created.workspace.workspace_id;
  }

  private writeSettings(): void {
    let transport: string | undefined;
    let provider: string | undefined;
    let model: string | undefined;
    try {
      const real = JSON.parse(readFileSync(join(REAL_AGENT_DIR, "settings.json"), "utf8")) as Record<string, unknown>;
      transport = typeof real.transport === "string" ? real.transport : undefined;
      provider = typeof real.defaultProvider === "string" ? real.defaultProvider : undefined;
      model = typeof real.defaultModel === "string" ? real.defaultModel : undefined;
      const override = process.env.PI_E2E_MODEL;
      if (override !== undefined) {
        const [nextProvider, nextModel] = override.split("/");
        provider = nextProvider ?? provider;
        model = nextModel ?? model;
      }
    } catch {
      // 没有全局 settings：pid 目录仍可用，模型走 pi 默认。
    }
    writeFileSync(
      join(this.agentDir, "settings.json"),
      JSON.stringify({
        transport,
        defaultProvider: provider,
        defaultModel: model,
        defaultThinkingLevel: "off",
        defaultProjectTrust: "always",
      }),
      "utf8",
    );
    writeFileSync(join(this.agentDir, "keybindings.json"), JSON.stringify({ "app.session.new": "f12" }), "utf8");
  }

  writeConfig(config: Record<string, unknown>): void {
    writeFileSync(join(this.agentDir, "pi-herdr-subagents-lite", "config.json"), JSON.stringify(config), "utf8");
  }

  writeProfile(name: string, frontmatter: string, body: string): void {
    const file = join(this.agentDir, "pi-herdr-subagents-lite", "profiles", `${name}.md`);
    writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  }

  async call(args: string[]): Promise<unknown> {
    const text = await run(HERDR_BIN as string, ["--session", this.sessionName, ...args], {
      env: this.env,
      cwd: this.root,
    });
    if (text.trim() === "") {
      return undefined;
    }
    const parsed = JSON.parse(text.trim()) as { result?: unknown; error?: { code?: string; message?: string } };
    if (parsed.error) {
      throw new Error(`herdr ${args.join(" ")}: ${parsed.error.code ?? ""} ${parsed.error.message ?? ""}`.trim());
    }
    return parsed.result;
  }

  async tabs(): Promise<TabInfo[]> {
    const result = (await this.call(["tab", "list"])) as { tabs: TabInfo[] };
    return result.tabs;
  }

  async panes(): Promise<PaneInfo[]> {
    const result = (await this.call(["pane", "list", "--workspace", this.workspaceId])) as { panes: PaneInfo[] };
    return result.panes;
  }

  async agents(): Promise<AgentInfo[]> {
    const result = (await this.call(["agent", "list"])) as { agents: AgentInfo[] };
    return result.agents;
  }

  async startParent(name: string): Promise<{ sessionFile: string; paneId: string }> {
    const sessionFile = join(this.agentDir, "sessions", `${name}.jsonl`);
    const tab = (await this.call([
      "tab",
      "create",
      "--workspace",
      this.workspaceId,
      "--cwd",
      this.project,
      "--no-focus",
    ])) as {
      root_pane: { pane_id: string };
    };
    await this.call([
      "agent",
      "start",
      name,
      "--kind",
      "pi",
      "--pane",
      tab.root_pane.pane_id,
      "--timeout",
      "30000",
      "--",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-mcp",
      "--tools",
      "subagent",
      "--session",
      sessionFile,
    ]);
    return { sessionFile, paneId: tab.root_pane.pane_id };
  }

  async type(paneId: string, text: string): Promise<void> {
    await this.call(["pane", "send-text", paneId, text]);
    await sleep(300);
    await this.call(["pane", "send-keys", paneId, "enter"]);
  }

  async prompt(agent: string, text: string): Promise<void> {
    await this.call(["agent", "prompt", agent, text]);
  }

  async tabFor(label: string): Promise<TabInfo | undefined> {
    return (await this.tabs()).find((tab) => tab.label === label);
  }

  async childPid(paneId: string): Promise<number> {
    const info = (await this.call(["pane", "process-info", "--pane", paneId])) as {
      process_info: { foreground_processes: Array<{ pid: number; argv0: string }> };
    };
    const found = info.process_info.foreground_processes.find((process) => /(^|[\\/])pi(\.exe)?$/i.test(process.argv0));
    if (!found) {
      throw new Error(`no pi process in pane ${paneId}`);
    }
    return found.pid;
  }

  async closeChildren(): Promise<void> {
    for (const tab of await this.tabs()) {
      if (!/^(explore|selfexit)-\d+$/.test(tab.label)) {
        continue;
      }
      for (const pane of await this.panes()) {
        if (pane.tab_id === tab.tab_id) {
          try {
            killProcess(await this.childPid(pane.pane_id));
          } catch {
            // pane 里已经没有 pi。
          }
        }
      }
      try {
        await this.call(["tab", "close", tab.tab_id]);
      } catch {
        // tab 可能已自行关闭。
      }
    }
    await waitFor(
      async () => (await this.tabs()).every((tab) => !/^(explore|selfexit)-\d+$/.test(tab.label)),
      "child tabs to close",
      30_000,
    );
    await waitFor(
      async () => (await this.agents()).every((agent) => !/^(explore|selfexit)-\d+$/.test(agent.name ?? "")),
      "child agents to disappear",
      30_000,
    );
  }

  async teardown(): Promise<void> {
    const bin = HERDR_BIN as string;
    try {
      await this.closeChildren();
    } catch {
      // 清理失败不阻止停服务器。
    }
    try {
      await run(bin, ["--session", this.sessionName, "server", "stop"], { env: this.env, timeout: 15_000 });
    } catch {
      // 服务器可能已退出。
    }
    try {
      await run(bin, ["session", "delete", this.sessionName], { env: this.env, timeout: 15_000 });
    } catch {
      // 同上。
    }
    this.server?.kill();
    if (process.env.PI_E2E_KEEP === "1") {
      return;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(this.root, { recursive: true, force: true });
        return;
      } catch {
        await sleep(500);
      }
    }
  }
}
