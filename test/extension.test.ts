import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, type ShutdownReason } from "../src/config/index.ts";
import {
  createExtension,
  type ExtensionRegistrar,
  type SessionContext,
  type SubagentTool,
} from "../src/extension/index.ts";
import type { ShutdownHandler } from "../src/extension/shutdown.ts";
import {
  type AgentEntry,
  type AgentSnapshot,
  type CloseTabResult,
  type HerdrHost,
  HerdrHostError,
  type ResumeAgentInput,
  type StartAgentInput,
} from "../src/herdr/index.ts";
import { loadProfiles, agentDir as resolveAgentDir } from "../src/profile/index.ts";
import type { RunStarted } from "../src/run/index.ts";
import { readExitReceipt, readLastAssistant, writeExitReceipt } from "../src/session-file/index.ts";

interface SentMessage {
  message: { customType: string; content: string; display: boolean };
  options: { triggerTurn?: boolean } | undefined;
}

interface SentUserMessage {
  content: string;
  options: { deliverAs?: "steer" | "followUp" } | undefined;
}

interface Notification {
  message: string;
  type: string | undefined;
}

type SessionStartHandler = (event: SessionStartEvent, ctx: SessionContext) => void;
type PromptEvent = { kind: "select" | "confirm" | "input" | "editor" | "custom"; title?: string };

function fakePi(events: string[] = []) {
  const tools: SubagentTool[] = [];
  const startHandlers: SessionStartHandler[] = [];
  const shutdownHandlers: ShutdownHandler[] = [];
  const settledHandlers: Array<(event: { type: "agent_settled" }, ctx: SessionContext) => void> = [];
  const promptStartHandlers: Array<(event: PromptEvent) => void> = [];
  const promptEndHandlers: Array<(event: PromptEvent) => void> = [];
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const sent: SentMessage[] = [];
  const userMessages: SentUserMessage[] = [];
  const notifications: Notification[] = [];
  let currentSession: SessionContext | undefined;
  let shutdowns = 0;
  let sendUserMessageImpl: (content: string) => void = () => {};
  let sendFailures = 0;
  const pi: ExtensionRegistrar = {
    events: {
      emit(channel, data) {
        emitted.push({ channel, data });
      },
    },
    on(
      event: "session_start" | "session_shutdown" | "agent_settled" | "ui_prompt_start" | "ui_prompt_end",
      handler:
        | SessionStartHandler
        | ((event: { type: "agent_settled" }, ctx: SessionContext) => void)
        | ShutdownHandler
        | ((event: PromptEvent) => void),
    ) {
      if (event === "session_start") {
        startHandlers.push(handler as SessionStartHandler);
        return;
      }
      if (event === "agent_settled") {
        settledHandlers.push(handler as (event: { type: "agent_settled" }, ctx: SessionContext) => void);
        return;
      }
      if (event === "ui_prompt_start") {
        promptStartHandlers.push(handler as (event: PromptEvent) => void);
        return;
      }
      if (event === "ui_prompt_end") {
        promptEndHandlers.push(handler as (event: PromptEvent) => void);
        return;
      }
      shutdownHandlers.push(handler as ShutdownHandler);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    sendMessage(message, options) {
      if (sendFailures > 0) {
        sendFailures -= 1;
        throw new Error("send failed");
      }
      events.push("sendMessage");
      sent.push({ message, options });
    },
    sendUserMessage(content, options) {
      userMessages.push({ content, options });
      sendUserMessageImpl(content);
    },
  };
  const startSession = (ctx: Partial<SessionContext> = {}) => {
    const session: SessionContext = {
      cwd: projectDir,
      isProjectTrusted: () => false,
      sessionManager: { getSessionFile: () => undefined },
      isIdle: () => true,
      ui: {
        notify: (message, type) => {
          notifications.push({ message, type });
        },
      },
      shutdown: () => {
        shutdowns += 1;
      },
      ...ctx,
    };
    currentSession = session;
    for (const handler of startHandlers) {
      handler({ type: "session_start", reason: "startup" }, session);
    }
  };
  const shutdownSession = async (reason: ShutdownReason = "quit") => {
    if (!currentSession) {
      throw new Error("no session");
    }
    const session = currentSession;
    for (const handler of shutdownHandlers) {
      await handler({ type: "session_shutdown", reason }, session);
    }
  };
  const settle = () => {
    if (!currentSession) {
      throw new Error("no session");
    }
    for (const handler of settledHandlers) {
      handler({ type: "agent_settled" }, currentSession);
    }
  };
  const prompt = (pair: "start" | "end", event: PromptEvent) => {
    for (const handler of pair === "start" ? promptStartHandlers : promptEndHandlers) {
      handler(event);
    }
  };
  return {
    emitted,
    get shutdowns() {
      return shutdowns;
    },
    notifications,
    pi,
    promptEnd: (event: PromptEvent = { kind: "custom" }) => prompt("end", event),
    promptStart: (event: PromptEvent = { kind: "custom" }) => prompt("start", event),
    sent,
    setSendFailures(count: number) {
      sendFailures = count;
    },
    setSendUserMessage(impl: (content: string) => void) {
      sendUserMessageImpl = impl;
    },
    settle,
    shutdownSession,
    startSession,
    tools,
    userMessages,
  };
}

interface FakeHostFailures {
  createTab?: (attempt: number) => Error | undefined;
  startAgent?: (attempt: number) => Error | undefined;
}

function fakeHost(
  options: { events?: string[]; failures?: FakeHostFailures; closeTab?: () => CloseTabResult | Error } = {},
) {
  const calls: string[] = options.events ?? [];
  const tabs: Array<{ cwd: string; label: string; env: Record<string, string> }> = [];
  const renamedTabs: Array<{ tabId: string; label: string }> = [];
  const renamedPanes: Array<{ paneId: string; label: string }> = [];
  const agents: StartAgentInput[] = [];
  const inboxAtStart: boolean[] = [];
  const resumed: ResumeAgentInput[] = [];
  const resumeInboxAtStart: number[] = [];
  let paneExists = true;
  let panes = 0;
  let starts = 0;
  const paneAgents = new Map<string, string>();
  let agentImpl: (name: string) => Promise<AgentSnapshot | null> = async () => null;
  let listAgentsImpl: (() => Promise<AgentEntry[]>) | undefined;
  let readAgentImpl: () => Promise<string> = async () => "Do you want to continue?";
  const host: HerdrHost = {
    async createTab(input) {
      calls.push("createTab");
      tabs.push(input);
      const error = options.failures?.createTab?.(tabs.length);
      if (error) {
        throw error;
      }
      panes += 1;
      return { tabId: `w1:t${panes}`, paneId: `w1:p${panes}` };
    },
    async renameTab(input) {
      calls.push("renameTab");
      renamedTabs.push(input);
    },
    async renamePane(input) {
      calls.push("renamePane");
      renamedPanes.push(input);
    },
    async startAgent(input) {
      calls.push("startAgent");
      agents.push(input);
      paneAgents.set(input.paneId, input.name);
      inboxAtStart.push(existsSync(`${input.sessionFile}.inbox`));
      starts += 1;
      const error = options.failures?.startAgent?.(starts);
      if (error) {
        throw error;
      }
    },
    async resumeAgent(input) {
      calls.push("resumeAgent");
      resumed.push(input);
      paneAgents.set(input.paneId, input.name);
      resumeInboxAtStart.push(pendingInbox(input.sessionFile));
    },
    async hasPane() {
      calls.push("hasPane");
      return paneExists;
    },
    async listAgents() {
      calls.push("listAgents");
      if (listAgentsImpl) {
        return listAgentsImpl();
      }
      const entries: AgentEntry[] = [];
      for (const [paneId, name] of paneAgents) {
        const snapshot = await agentImpl(name);
        if (snapshot) {
          entries.push({ name, paneId, status: snapshot.status, completionSeq: snapshot.completionSeq });
        }
      }
      return entries;
    },

    async readAgent() {
      calls.push("readAgent");
      return readAgentImpl();
    },

    async closeTabIfOnlyPane() {
      calls.push("closeTabIfOnlyPane");
      const outcome = options.closeTab?.() ?? "closed";
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    },
  };
  return {
    agents,
    calls,
    host,
    inboxAtStart,
    renamedPanes,
    renamedTabs,
    resumeInboxAtStart,
    resumed,
    setAgents(impl: (name: string) => Promise<AgentSnapshot | null>) {
      agentImpl = impl;
    },
    setListAgents(impl: () => Promise<AgentEntry[]>) {
      listAgentsImpl = impl;
    },
    setReadAgent(impl: () => Promise<string>) {
      readAgentImpl = impl;
    },
    setPaneExists(value: boolean) {
      paneExists = value;
    },
    tabs,
  };
}

let agentDir = "";
let projectDir = "";

function configFile(): string {
  return join(agentDir, "pi-herdr-subagents-lite", "config.json");
}

function writeConfig(value: unknown) {
  const merged =
    typeof value === "object" && value !== null && !Array.isArray(value) ? { aggregateWindowMs: 0, ...value } : value;
  mkdirSync(dirname(configFile()), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(merged));
}

function writeProfile(fileName: string, content: string) {
  const file = join(agentDir, "pi-herdr-subagents-lite", "profiles", fileName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function sessionsRoot(): string {
  return join(agentDir, "pi-herdr-subagents-lite", "sessions");
}

function writeProjectProfile(fileName: string, content: string) {
  const file = join(projectDir, ".pi", "pi-herdr-subagents-lite", "profiles", fileName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function registerExtension(pi: ExtensionRegistrar, host: HerdrHost) {
  createExtension({
    host,
    readLastAssistant,
    readExitReceipt,
    loadConfig: () => loadConfig(resolveAgentDir()),
    loadProfiles,
    writeExitReceipt,
  })(pi);
}

function loadSession(host: HerdrHost, events: string[] = [], ctx?: Partial<SessionContext>) {
  const fake = fakePi(events);
  const { notifications, pi, sent, shutdownSession, startSession, tools } = fake;
  registerExtension(pi, host);
  startSession(ctx);
  const tool = tools[0];
  if (tools.length !== 1 || !tool) {
    throw new Error(`expected one registered tool, got ${tools.length}`);
  }
  return { notifications, sent, setSendFailures: fake.setSendFailures, shutdownSession, startSession, tool };
}

function loadTool(host: HerdrHost, ctx?: Partial<SessionContext>) {
  return loadSession(host, [], ctx).tool;
}

function loadTimedSession(
  getAgent: (name: string) => Promise<AgentSnapshot | null>,
  closeTab?: () => CloseTabResult | Error,
) {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const fake = fakeHost({ events: calls, closeTab });
  fake.setAgents(getAgent);
  return { ...loadSession(fake.host, calls), calls, fake };
}

function childSessionFile(): string {
  return join(agentDir, "child.jsonl");
}

function pendingInbox(sessionFile: string): number {
  try {
    return readdirSync(`${sessionFile}.inbox`).filter((name) => name.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

function writeInbox(sessionFile: string, files: Array<[name: string, text: string]>) {
  const dir = `${sessionFile}.inbox`;
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of files) {
    writeFileSync(join(dir, name), text);
  }
}

function loadAutoExitChild(options: { env?: string | null } = {}) {
  if (options.env === null) {
    delete process.env.PI_SUBAGENT_AUTO_EXIT;
  } else {
    process.env.PI_SUBAGENT_AUTO_EXIT = options.env ?? "1";
  }
  const sessionFile = childSessionFile();
  const fake = fakePi();
  registerExtension(fake.pi, fakeHost().host);
  fake.startSession({ sessionManager: { getSessionFile: () => sessionFile } });
  return { fake, sessionFile };
}

function loadChild(sessionFile: string | undefined, options: { isIdle?: () => boolean } = {}) {
  const fake = fakePi();
  registerExtension(fake.pi, fakeHost().host);
  fake.startSession({
    sessionManager: { getSessionFile: () => sessionFile },
    isIdle: options.isIdle ?? (() => true),
  });
  return fake;
}

async function runProfiles(
  tool: SubagentTool,
  cases: Array<readonly [task: string, profile: string]>,
): Promise<RunStarted[]> {
  const started: RunStarted[] = [];
  for (const [task, profile] of cases) {
    const result = await runTask(tool, task, profile);
    expect(result.isError).toBe(false);
    started.push(parseStarted(result));
  }
  return started;
}

function runTasks(tool: SubagentTool, count: number): Promise<RunStarted[]> {
  return runProfiles(
    tool,
    Array.from({ length: count }, (_, index) => [`task ${index + 1}`, "worker"] as const),
  );
}

function runTask(tool: SubagentTool, task: string, profile = "worker") {
  return tool.execute("call-1", { action: "run", profile, task }, undefined, undefined, {} as never);
}

function sendTask(tool: SubagentTool, name: string, message: string) {
  return tool.execute("call-2", { action: "send", name, message }, undefined, undefined, {} as never);
}

async function exitedChild(options: { profile?: string; baseline?: AgentSnapshot } = {}) {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const profile = options.profile ?? "explore";
  const fake = fakeHost();
  let beforeResume: AgentSnapshot | null = { status: "idle", completionSeq: 1 };
  let afterResume: AgentSnapshot | null = options.baseline ?? { status: "working", completionSeq: 1 };
  let name = "";
  fake.setAgents(async (agentName) => {
    if (agentName !== name) {
      return null;
    }
    return fake.resumed.length > 0 ? afterResume : beforeResume;
  });
  const session = loadSession(fake.host);
  const started = parseStarted(await runTask(session.tool, "inspect the repo", profile));
  name = started.name;
  writeFileSync(started.sessionFile, `${assistantLine("old result")}\n`);
  await vi.advanceTimersByTimeAsync(1000);
  beforeResume = null;
  return {
    ...session,
    fake,
    setAfterResume(snapshot: AgentSnapshot | null) {
      afterResume = snapshot;
    },
    started,
  };
}

function startRun(
  fake: ReturnType<typeof fakeHost>,
  options: { profile?: string; task?: string } = {},
): Promise<{ agent: StartAgentInput; started: RunStarted }> {
  return runTask(loadTool(fake.host), options.task ?? "inspect the repo", options.profile).then((result) => {
    const started = parseStarted(result);
    const agent = fake.agents[0];
    if (!agent) {
      throw new Error("expected startAgent to be called");
    }
    return { agent, started };
  });
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  if (block?.type !== "text" || block.text === undefined) {
    throw new Error("expected text content");
  }
  return block.text;
}

function parseStarted(result: { content: Array<{ type: string; text?: string }> }): RunStarted {
  return JSON.parse(firstText(result)) as RunStarted;
}

function assistantLine(text: string): string {
  return JSON.stringify({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function pendingAskLine(): string {
  return JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Need a decision." },
        { type: "toolCall", id: "call-1", name: "ask_user_question", arguments: {} },
      ],
    },
  });
}

const tempDirs = new Set<string>();

beforeEach(() => {
  delete process.env.HERDR_ENV;
  delete process.env.PI_SUBAGENT_AUTO_EXIT;
  agentDir = mkdtempSync(join(tmpdir(), "pi-herdr-agent-"));
  projectDir = mkdtempSync(join(tmpdir(), "pi-herdr-project-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeProfile("worker.md", "Worker body.\n");
  writeConfig({});
  tempDirs.add(agentDir);
  tempDirs.add(projectDir);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
  delete process.env.HERDR_ENV;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_SUBAGENT_AUTO_EXIT;
});

it("accepts run and send", () => {
  const tool = loadTool(fakeHost().host);

  expect(tool.name).toBe("subagent");
  expect(tool.label).toBe("Subagent");

  const schema = tool.parameters as unknown as {
    type: string;
    oneOf: Array<{
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required: string[];
      additionalProperties: boolean;
    }>;
  };
  expect(schema.type).toBe("object");
  expect(schema.oneOf).toHaveLength(2);

  const [run, send] = schema.oneOf;
  expect(run?.type).toBe("object");
  expect(run?.properties.action).toMatchObject({ const: "run" });
  expect(run?.properties.task).toMatchObject({ type: "string", minLength: 1 });
  expect(run?.required).toEqual(["action", "profile", "task"]);
  expect(run?.additionalProperties).toBe(false);

  expect(send?.type).toBe("object");
  expect(send?.properties.action).toMatchObject({ const: "send" });
  expect(send?.properties.name).toMatchObject({ type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$" });
  expect(send?.properties.message).toMatchObject({ type: "string", minLength: 1 });
  expect(send?.required).toEqual(["action", "name", "message"]);
  expect(send?.additionalProperties).toBe(false);
});

it("reports config errors without registering", () => {
  writeConfig({ nope: 1 });
  const { pi, tools } = fakePi();

  expect(() => registerExtension(pi, fakeHost().host)).toThrow(/nope/);
  expect(tools).toHaveLength(0);
});

it("resolves the agent dir for config", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-herdr-home-"));
  const configDir = join(home, "agent", "pi-herdr-subagents-lite");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ toolName: "tilde_tool" }));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", "~/agent");
  try {
    expect(loadTool(fakeHost().host).name).toBe("tilde_tool");
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("rejects outside herdr", async () => {
  const { calls, host } = fakeHost();
  const tool = loadTool(host);

  const result = await tool.execute(
    "call-1",
    { action: "run", profile: "worker", task: "inspect the repo" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    {
      type: "text",
      text: "not_in_herdr: run pi inside a herdr pane; there is no fallback.",
    },
  ]);
  expect(calls).toEqual([]);
});

it("documents the asynchronous prompt contract", () => {
  const tool = loadTool(fakeHost().host);
  const description = tool.description.toLowerCase();
  const snippet = (tool.promptSnippet ?? "").toLowerCase();
  const guidelines = (tool.promptGuidelines ?? []).join("\n").toLowerCase();

  expect(description).toContain("start a subagent");
  expect(description).toContain("asynchronously");
  expect(snippet).toContain("background subagent");
  expect(snippet).toContain("asynchronously");
  expect(guidelines).toContain("subagent_result");
  expect(guidelines).toContain("available profiles");
});

it("launches a worker", async () => {
  process.env.HERDR_ENV = "1";
  const fake = fakeHost();
  const { agent, started } = await startRun(fake);

  expect(started).toMatchObject({ state: "running", name: "worker-1", paneId: "w1:p1" });
  expect(fake.tabs).toEqual([{ cwd: process.cwd(), label: "worker-1", env: { PI_SUBAGENT_AUTO_EXIT: "0" } }]);
  expect(agent).toMatchObject({ name: "worker-1", paneId: started.paneId, sessionFile: started.sessionFile });
  const brief = await readFile(agent.briefFile, "utf8");
  expect(brief).toContain("inspect the repo");
  expect(brief).toContain("You are a worker subagent");
  expect(brief).toContain("Do not spawn subagents");
});

it("writes the child session under the agent dir", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore the repo\n---\n\nExplore body.\n");
  const { agent, started } = await startRun(fakeHost(), { profile: "explore" });

  expect(started.sessionFile).toBe(agent.sessionFile);
  expect(started.sessionFile.startsWith(join(sessionsRoot(), "explore-1-"))).toBe(true);
  expect(started.sessionFile.endsWith(".jsonl")).toBe(true);
  expect(existsSync(sessionsRoot())).toBe(true);
});

it("creates the child inbox before start", async () => {
  process.env.HERDR_ENV = "1";
  const fake = fakeHost();

  const { started } = await startRun(fake);

  expect(existsSync(`${started.sessionFile}.inbox`)).toBe(true);
  expect(fake.inboxAtStart).toEqual([true]);
});

it("keeps brief and identity next to the session", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\ndescription: worker\n---\n\nWorker body.\n");
  const { agent, started } = await startRun(fakeHost());

  const identity = `${started.sessionFile}.identity.md`;
  expect(dirname(started.sessionFile)).toBe(sessionsRoot());
  expect(agent.briefFile).toBe(`${started.sessionFile}.brief.md`);
  expect(agent.agentArgs).toEqual(expect.arrayContaining(["--append-system-prompt", identity]));
  expect(await readFile(agent.briefFile, "utf8")).toContain("inspect the repo");
  expect(await readFile(identity, "utf8")).toBe("Worker body.");
});

it("starts a run with a global profile", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore the repo\n---\n\nExplore body.\n");

  const { started } = await startRun(fakeHost(), { profile: "explore" });

  expect(started).toMatchObject({ state: "running", name: "explore-1", paneId: "w1:p1" });
});

it("uses the profile cwd", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\ncwd: sub\n---\n\nWorker body.\n");
  const nested = fakeHost();

  await startRun(nested);

  expect(nested.tabs).toEqual([
    { cwd: join(process.cwd(), "sub"), label: "worker-1", env: { PI_SUBAGENT_AUTO_EXIT: "0" } },
  ]);

  writeProfile("worker.md", "---\ndescription: no cwd\n---\n\nWorker body.\n");
  const plain = fakeHost();

  await startRun(plain);

  expect(plain.tabs).toEqual([{ cwd: process.cwd(), label: "worker-1", env: { PI_SUBAGENT_AUTO_EXIT: "0" } }]);
});

it("passes model and thinking", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\nmodel: opencode-go/x\nthinking: high\n---\n\nWorker body.\n");

  const { agent } = await startRun(fakeHost());

  expect(agent.agentArgs).toEqual(expect.arrayContaining(["--model", "opencode-go/x", "--thinking", "high"]));
});

it("writes the identity file", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\ndescription: append\n---\n\nExplore body.\n");

  const appended = await startRun(fakeHost());
  const identity = `${appended.started.sessionFile}.identity.md`;
  expect(await readFile(identity, "utf8")).toBe("Explore body.");
  expect(appended.agent.agentArgs).toEqual(expect.arrayContaining(["--append-system-prompt", identity]));
  expect(appended.agent.agentArgs).not.toContain("--system-prompt");

  writeProfile("worker.md", "---\nsystem-prompt: replace\n---\n\nReplace body.\n");
  const replaced = await startRun(fakeHost());
  const secondIdentity = `${replaced.started.sessionFile}.identity.md`;
  expect(await readFile(secondIdentity, "utf8")).toBe("Replace body.");
  expect(replaced.agent.agentArgs).toEqual(expect.arrayContaining(["--system-prompt", secondIdentity]));
  expect(replaced.agent.agentArgs).not.toContain("--append-system-prompt");

  writeProfile("worker.md", "---\nsystem-prompt: task\n---\n\nTask body.\n");
  const tasked = await startRun(fakeHost());
  expect(existsSync(`${tasked.started.sessionFile}.identity.md`)).toBe(false);
  expect(tasked.agent.agentArgs).not.toContain("--append-system-prompt");
  expect(tasked.agent.agentArgs).not.toContain("--system-prompt");
  expect((await readFile(tasked.agent.briefFile, "utf8")).startsWith("Task body.")).toBe(true);
});

it("maps tools", async () => {
  process.env.HERDR_ENV = "1";
  const cases: Array<[string, string[]]> = [
    ["read,bash", ["--tools", "read,bash"]],
    ["+read,-subagent", ["--tools", "+read,-subagent"]],
    ['""', ["--no-tools"]],
  ];

  for (const [tools, expected] of cases) {
    writeProfile("worker.md", `---\ntools: ${tools}\n---\n\nWorker body.\n`);

    const { agent } = await startRun(fakeHost());

    expect(agent.agentArgs).toEqual(expect.arrayContaining(expected));
    expect(agent.agentArgs).not.toContain(expected[0] === "--no-tools" ? "--tools" : "--no-tools");
  }
});

it("maps skills", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\nskills: [a, b]\n---\n\nWorker body.\n");

  const named = await startRun(fakeHost());

  expect(named.agent.agentArgs).toEqual(
    expect.arrayContaining([
      "--no-skills",
      "--skill",
      join(agentDir, "skills", "a"),
      "--skill",
      join(agentDir, "skills", "b"),
    ]),
  );

  writeProfile("worker.md", "---\ndescription: none\n---\n\nWorker body.\n");

  const plain = await startRun(fakeHost());

  expect(plain.agent.agentArgs).not.toContain("--skill");
  expect(plain.agent.agentArgs).not.toContain("--no-skills");
});

it("labels the pane with the first task line", async () => {
  process.env.HERDR_ENV = "1";

  const markdown = fakeHost();
  await startRun(markdown, { task: "## Fix   the **bug**\r\nsecond line" });

  expect(markdown.renamedPanes).toEqual([{ paneId: "w1:p1", label: "Fix the bug" }]);

  const long = fakeHost();
  await startRun(long, { task: "x".repeat(40) });

  expect(long.renamedPanes).toEqual([{ paneId: "w1:p1", label: "x".repeat(32) }]);
});

it("sets the auto-exit pane env", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\nauto-exit: true\n---\n\nExplore body.\n");
  const fake = fakeHost();
  const { tool } = loadSession(fake.host);

  await runTask(tool, "worker task");
  await runTask(tool, "explore task", "explore");

  expect(fake.tabs.map((tab) => tab.env)).toEqual([{ PI_SUBAGENT_AUTO_EXIT: "0" }, { PI_SUBAGENT_AUTO_EXIT: "1" }]);
});

it("queues a message for a live child", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore\n---\n\nExplore body.\n");
  const fake = fakeHost();
  fake.setAgents(async () => ({ status: "working", completionSeq: 0 }));
  const { tool } = loadSession(fake.host);
  const started = parseStarted(await runTask(tool, "inspect the repo", "explore"));

  const result = await sendTask(tool, "explore-1", "Also check the Windows branch.");

  expect(result.isError).toBe(false);
  expect(firstText(result)).toBe('{"state":"sent","name":"explore-1"}');
  const files = (await readdir(`${started.sessionFile}.inbox`)).filter((name) => name.endsWith(".md"));
  expect(files).toHaveLength(1);
  const content = await readFile(join(`${started.sessionFile}.inbox`, files[0] ?? ""), "utf8");
  expect(content.startsWith("[from parent]")).toBe(true);
  expect(content).toContain("Also check the Windows branch.");
});

it("resumes the exited child in its pane", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { fake, started, tool } = await exitedChild({ profile: "explore" });

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(false);
  expect(firstText(result)).toBe(JSON.stringify({ state: "restarted", name: "explore-1", paneId: started.paneId }));
  expect(fake.resumed).toHaveLength(1);
  expect(fake.resumed[0]).toMatchObject({
    name: "explore-1",
    paneId: started.paneId,
    sessionFile: started.sessionFile,
  });
  expect(fake.resumed[0]).not.toHaveProperty("briefFile");
  expect(fake.resumeInboxAtStart).toEqual([0]);
  expect(pendingInbox(started.sessionFile)).toBe(1);
});

it("opens a new tab when the pane is gone", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { fake, started, tool } = await exitedChild({ profile: "explore" });
  fake.setPaneExists(false);

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(false);
  expect(JSON.parse(firstText(result))).toEqual({
    state: "restarted",
    name: "explore-1",
    paneId: "w1:p2",
  });
  expect(fake.tabs.at(-1)).toEqual({ cwd: process.cwd(), label: "explore-1", env: { PI_SUBAGENT_AUTO_EXIT: "0" } });
  expect(fake.resumed[0]?.paneId).toBe("w1:p2");
  expect(fake.resumed[0]?.sessionFile).toBe(started.sessionFile);
});

it("refuses a dirty session", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { fake, started, tool } = await exitedChild({ profile: "explore" });
  writeFileSync(started.sessionFile, `${pendingAskLine()}\n`);

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "tail_dirty" });
  expect(fake.resumed).toHaveLength(0);
  expect(pendingInbox(started.sessionFile)).toBe(0);
});

it("refuses a missing session", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { fake, started, tool } = await exitedChild({ profile: "explore" });
  rmSync(started.sessionFile, { force: true });

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "session_missing" });
  expect(fake.resumed).toHaveLength(0);
  expect(pendingInbox(started.sessionFile)).toBe(0);
});

it("re-reads the profile on restart", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nOld body.\n");
  const { fake, setAfterResume, started, tool } = await exitedChild({ profile: "explore" });

  writeProfile("explore.md", "---\nmodel: new/model\n---\n\nNew body.\n");

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(false);
  expect(fake.resumed[0]?.agentArgs).toEqual(expect.arrayContaining(["--model", "new/model"]));
  expect(await readFile(`${started.sessionFile}.identity.md`, "utf8")).toBe("New body.");

  rmSync(join(agentDir, "pi-herdr-subagents-lite", "profiles", "explore.md"), { force: true });
  setAfterResume(null);

  const missing = await sendTask(tool, "explore-1", "again");

  expect(missing.isError).toBe(true);
  expect(missing.details).toMatchObject({ code: "unknown_profile" });
  expect(fake.resumed).toHaveLength(1);
});

it("delivers only the result after the restart", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { sent, setAfterResume, started, tool } = await exitedChild({
    profile: "explore",
    baseline: { status: "idle", completionSeq: 3 },
  });

  expect(sent).toHaveLength(1);

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(false);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  setAfterResume({ status: "idle", completionSeq: 4 });
  writeFileSync(started.sessionFile, `${assistantLine("new result")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.message.content).toContain("new result");
  expect(sent[1]?.message.content).not.toContain("old result");

  await vi.advanceTimersByTimeAsync(2000);
  expect(sent).toHaveLength(2);
});

it("keeps finished runs for send", async () => {
  writeConfig({ maxConcurrent: 1 });
  writeProfile("explore.md", "---\nmodel: old/model\nauto-exit: true\n---\n\nExplore body.\n");
  const { fake, sent, setAfterResume, started, tool } = await exitedChild({ profile: "explore" });

  const restarted = await sendTask(tool, "explore-1", "continue the task");

  expect(restarted.isError).toBe(false);
  expect(JSON.parse(firstText(restarted))).toMatchObject({ state: "restarted", name: "explore-1" });
  expect(fake.resumed).toHaveLength(1);

  setAfterResume({ status: "idle", completionSeq: 2 });
  writeFileSync(started.sessionFile, `${assistantLine("second result")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);

  const next = await runTask(tool, "next task", "explore");

  expect(next.isError).toBe(false);
  expect(parseStarted(next).name).toBe("explore-2");
});

it("sends to a renamed agent by pane id", async () => {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const fake = fakeHost();
  const { sent, tool } = loadSession(fake.host);
  const started = parseStarted(await runTask(tool, "inspect the repo"));
  fake.setListAgents(async () => [
    { name: "renamed-worker", paneId: started.paneId, status: "idle", completionSeq: 1 },
  ]);

  const reply = await sendTask(tool, "worker-1", "next turn");

  expect(reply.isError).toBe(false);
  expect(firstText(reply)).toBe('{"state":"sent","name":"worker-1"}');
  expect(fake.resumed).toHaveLength(0);
  expect(sent).toHaveLength(0);
});

it("re-reads auto-exit when restarting", async () => {
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const { fake, sent, setAfterResume, started, tool } = await exitedChild({ profile: "explore" });
  writeProfile("explore.md", "---\nmodel: old/model\nauto-exit: true\n---\n\nExplore body.\n");

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(firstText(result)).toBe(JSON.stringify({ state: "restarted", name: "explore-1", paneId: started.paneId }));

  setAfterResume({ status: "idle", completionSeq: 2 });
  writeFileSync(started.sessionFile, `${assistantLine("new result")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.message.content).toContain("new result");
  expect(fake.calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
});

it("re-arms a finished child that is still alive", async () => {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\nmodel: old/model\n---\n\nExplore body.\n");
  const fake = fakeHost({ closeTab: () => "kept" });
  fake.setAgents(async () => ({ status: "idle", completionSeq: 1 }));
  const { tool } = loadSession(fake.host);
  const started = parseStarted(await runTask(tool, "inspect the repo", "explore"));
  writeFileSync(started.sessionFile, `${assistantLine("old result")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  const result = await sendTask(tool, "explore-1", "continue the task");

  expect(result.isError).toBe(false);
  expect(firstText(result)).toBe('{"state":"sent","name":"explore-1"}');
  expect(fake.resumed).toHaveLength(0);
  expect(pendingInbox(started.sessionFile)).toBe(1);
});

it("rejects unknown agent", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore\n---\n\nExplore body.\n");
  const { tool } = loadSession(fakeHost().host);
  const started = parseStarted(await runTask(tool, "inspect the repo", "explore"));

  const result = await sendTask(tool, "ghost", "hello");

  expect(result.isError).toBe(true);
  const text = firstText(result);
  expect(text.startsWith("unknown_agent:")).toBe(true);
  expect(text).toContain("explore-1");
  expect(await readdir(`${started.sessionFile}.inbox`)).toEqual([]);
});

it("lists profiles on unknown profile", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore the repo\n---\n\nExplore body.\n");
  const { calls, host } = fakeHost();
  const tool = loadTool(host);

  const result = await runTask(tool, "inspect the repo", "nope");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "unknown_profile" });
  expect(firstText(result)).toContain("explore");
  expect(calls).toEqual([]);
});

it("reports invalid profile", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\nthinking: sometimes\n---\n\nExplore body.\n");
  const { calls, host } = fakeHost();
  const tool = loadTool(host);

  const result = await runTask(tool, "inspect the repo", "explore");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "profile_invalid" });
  const text = firstText(result);
  expect(text).toContain("explore.md");
  expect(text).toContain("thinking");
  expect(calls).toEqual([]);
});

it("uses configured max concurrent", async () => {
  writeConfig({ maxConcurrent: 2 });
  const limited = loadTimedSession(async () => null);

  await runTask(limited.tool, "task 1");
  const second = parseStarted(await runTask(limited.tool, "task 2"));

  expect(second.name).toBe("worker-2");

  const rejected = await runTask(limited.tool, "task 3");

  expect(rejected.isError).toBe(true);
  expect(rejected.details).toMatchObject({ code: "max_concurrent" });
  expect(firstText(rejected)).toContain("worker-2");

  rmSync(configFile(), { force: true });

  const defaults = loadTimedSession(async () => null);
  await runTasks(defaults.tool, 3);
});

it("rejects the seventeenth active worker by default", async () => {
  const { calls, tool } = loadTimedSession(async () => null);

  await runTasks(tool, 16);

  const result = await runTask(tool, "task 17");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "max_concurrent" });
  const text = firstText(result);
  expect(text.startsWith("max_concurrent: ")).toBe(true);
  expect(text).toContain("worker-16");
  expect(calls.filter((call) => call === "createTab")).toHaveLength(16);
});

it("starts a fresh service for each session", async () => {
  process.env.HERDR_ENV = "1";
  const { host } = fakeHost();
  const { startSession, tool } = loadSession(host);

  expect(parseStarted(await runTask(tool, "first task")).name).toBe("worker-1");
  startSession();
  expect(parseStarted(await runTask(tool, "next session")).name).toBe("worker-1");
});

it("registers the tool at session start", () => {
  process.env.HERDR_ENV = "1";
  const { pi, startSession, tools } = fakePi();

  registerExtension(pi, fakeHost().host);

  expect(tools).toHaveLength(0);

  startSession();

  expect(tools.map((tool) => tool.name)).toEqual(["subagent"]);
});

it("honors tool name", () => {
  process.env.HERDR_ENV = "1";
  writeConfig({ toolName: "helper" });
  const registered = fakePi();

  registerExtension(registered.pi, fakeHost().host);
  registered.startSession();

  expect(registered.tools.map((tool) => tool.name)).toEqual(["helper"]);

  for (const invalid of ["Helper", "1x", "a".repeat(33)]) {
    writeConfig({ toolName: invalid });
    const failed = fakePi();

    expect(() => registerExtension(failed.pi, fakeHost().host)).toThrow(/toolName/);
    expect(failed.tools).toHaveLength(0);
  }
});

it("skips registration when disabled", () => {
  process.env.HERDR_ENV = "1";
  writeConfig({ enabled: false });
  const { pi, startSession, tools } = fakePi();

  registerExtension(pi, fakeHost().host);
  startSession();

  expect(tools).toHaveLength(0);
});

it("emits without the subagent tool", () => {
  writeConfig({ enabled: false });
  const { emitted, pi, promptStart, startSession } = fakePi();

  registerExtension(pi, fakeHost().host);
  startSession();
  promptStart({ kind: "custom", title: "Pick one" });

  expect(emitted).toEqual([{ channel: "herdr:blocked", data: { active: true, label: "Pick one" } }]);
});

it("expands profiles in guidelines", () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore the repo\n---\n\nExplore body.\n");

  const defaults = loadSession(fakeHost().host);
  expect(defaults.tool.promptGuidelines?.join("\n")).toContain("explore — Explore the repo");

  writeProfile("named.md", "---\nname: Explorer\ndescription: Named profile\n---\n\nNamed body.\n");
  const named = loadSession(fakeHost().host);
  expect(named.tool.promptGuidelines?.join("\n")).toContain("Explorer — Named profile");

  writeConfig({ prompts: { guidelines: ["Use {{toolName}}"] } });
  const overridden = loadSession(fakeHost().host);
  expect(overridden.tool.promptGuidelines).toEqual(["Use subagent"]);

  writeConfig({ prompts: { snippet: "" } });
  const hidden = loadSession(fakeHost().host);
  expect(hidden.tool.promptSnippet).toBe("");
});

it("reads project profiles only when trusted", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("worker.md", "---\ndescription: Global worker\n---\n\nGlobal body.\n");
  writeProjectProfile("worker.md", "---\ndescription: Project worker\n---\n\nProject body.\n");
  writeProjectProfile("project.md", "---\ndescription: Project profile\n---\n\nProject body.\n");

  const untrusted = loadSession(fakeHost().host);
  const untrustedGuidelines = untrusted.tool.promptGuidelines?.join("\n") ?? "";
  expect(untrustedGuidelines).not.toContain("Project worker");
  expect(untrustedGuidelines).not.toContain("Project profile");
  expect(firstText(await runTask(untrusted.tool, "inspect", "project"))).toContain("unknown_profile");

  const trusted = loadSession(fakeHost().host, [], { cwd: projectDir, isProjectTrusted: () => true });
  const trustedGuidelines = trusted.tool.promptGuidelines?.join("\n") ?? "";
  expect(trustedGuidelines).toContain("worker — Project worker");
  expect(trustedGuidelines).not.toContain("Global worker");
  expect(trustedGuidelines).toContain("project — Project profile");
  expect(parseStarted(await runTask(trusted.tool, "inspect", "project")).name).toBe("project-1");
});

it("hides non-invocable profiles", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("secret.md", "---\ndescription: Hidden profile\ndisable-model-invocation: true\n---\n\nSecret body.\n");

  const tool = loadTool(fakeHost().host);
  expect(tool.promptGuidelines?.join("\n")).not.toContain("secret");

  const result = await runTask(tool, "inspect", "secret");
  expect(result.isError).toBe(false);
  expect(parseStarted(result).name).toBe("secret-1");
});

it("names runs after the profile", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("explore.md", "---\ndescription: Explore\n---\n\nExplore body.\n");
  const { host } = fakeHost();
  const tool = loadTool(host);

  const started = await runProfiles(tool, [
    ["first explore", "explore"],
    ["second explore", "explore"],
  ]);

  expect(started.map((run) => run.name)).toEqual(["explore-1", "explore-2"]);
});

it("slugifies profile names", async () => {
  process.env.HERDR_ENV = "1";
  writeProfile("Code Review!.md", "---\ndescription: Review\n---\n\nReview body.\n");
  writeProfile("9lives.md", "---\ndescription: Nine\n---\n\nNine body.\n");
  writeProfile("a-very-long-profile-name.md", "---\ndescription: Long\n---\n\nLong body.\n");
  const { host } = fakeHost();
  const tool = loadTool(host);

  const started = await runProfiles(tool, [
    ["review", "Code Review!"],
    ["nine", "9lives"],
    ["long", "a-very-long-profile-name"],
  ]);

  expect(started.map((run) => run.name)).toEqual(["code-review-1", "agent-9lives-1", "a-very-long-prof-1"]);
});

it("retries name_taken with next worker", async () => {
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const { agents, host, renamedTabs } = fakeHost({
    events: calls,
    failures: { startAgent: (attempt) => (attempt === 1 ? new HerdrHostError("name_taken", "taken") : undefined) },
  });
  const { sent, tool } = loadSession(host, calls);

  const started = parseStarted(await runTask(tool, "retry task"));

  expect(started.name).toBe("worker-2");
  expect(calls.filter((call) => call === "createTab")).toHaveLength(1);
  expect(calls.filter((call) => call === "startAgent")).toHaveLength(2);
  expect(renamedTabs).toEqual([{ tabId: "w1:t1", label: "worker-2" }]);
  expect(agents[0]?.sessionFile.startsWith(join(sessionsRoot(), "worker-1-"))).toBe(true);
  expect(agents[1]?.sessionFile.startsWith(join(sessionsRoot(), "worker-2-"))).toBe(true);
  expect(agents[1]?.sessionFile).not.toBe(agents[0]?.sessionFile);
  expect(agents[1]?.briefFile).toBe(`${agents[1]?.sessionFile}.brief.md`);
  const [firstAgent, secondAgent] = agents;
  if (!firstAgent || !secondAgent) {
    throw new Error("expected two startAgent calls");
  }
  expect(existsSync(`${firstAgent.sessionFile}.brief.md`)).toBe(false);
  expect(existsSync(`${firstAgent.sessionFile}.identity.md`)).toBe(false);
  expect(existsSync(`${firstAgent.sessionFile}.inbox`)).toBe(false);
  expect(existsSync(`${secondAgent.sessionFile}.brief.md`)).toBe(true);
  expect(existsSync(`${secondAgent.sessionFile}.identity.md`)).toBe(true);
  expect(existsSync(`${secondAgent.sessionFile}.inbox`)).toBe(true);
  expect(sent).toHaveLength(0);
});

it("gives up after 100 name retries", async () => {
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  let nameTaken = true;
  const { agents, host } = fakeHost({
    events: calls,
    failures: { startAgent: () => (nameTaken ? new HerdrHostError("name_taken", "taken") : undefined) },
  });
  const { sent, tool } = loadSession(host, calls);

  const result = await runTask(tool, "retry task");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "name_exhausted" });
  expect(agents.map((agent) => agent.name)).toEqual(Array.from({ length: 100 }, (_, index) => `worker-${index + 1}`));
  expect(calls.filter((call) => call === "startAgent")).toHaveLength(100);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
  expect(agents.filter((agent) => existsSync(`${agent.sessionFile}.brief.md`))).toEqual([]);
  expect(agents.filter((agent) => existsSync(`${agent.sessionFile}.identity.md`))).toEqual([]);
  expect(agents.filter((agent) => existsSync(`${agent.sessionFile}.inbox`))).toEqual([]);
  expect(sent).toHaveLength(0);

  nameTaken = false;

  expect((await runTask(tool, "next task")).isError).toBe(false);
});

it("uses distinct child sessions", async () => {
  process.env.HERDR_ENV = "1";
  const { host } = fakeHost();
  const tool = loadTool(host);

  const first = parseStarted(await runTask(tool, "first task"));
  const second = parseStarted(await runTask(tool, "second task"));

  expect(first.name).toBe("worker-1");
  expect(second.name).toBe("worker-2");
  expect(first.sessionFile.startsWith(join(sessionsRoot(), "worker-1-"))).toBe(true);
  expect(second.sessionFile.startsWith(join(sessionsRoot(), "worker-2-"))).toBe(true);
  expect(second.sessionFile).not.toBe(first.sessionFile);
});

it("reports createTab failure", async () => {
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  let createTabError: Error | undefined = new HerdrHostError("tab_create_failed", "workspace is gone");
  const { host } = fakeHost({ events: calls, failures: { createTab: () => createTabError } });
  const { sent, tool } = loadSession(host, calls);

  const result = await runTask(tool, "inspect the repo");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "spawn_failed" });
  expect(firstText(result)).toContain("workspace is gone");
  expect(calls.filter((call) => call === "startAgent")).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
  expect(sent).toHaveLength(0);

  createTabError = undefined;

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
});

it("reports startAgent failure with pane", async () => {
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  let ready = false;
  const { host } = fakeHost({
    events: calls,
    failures: {
      startAgent: () => (ready ? undefined : new HerdrHostError("agent_not_ready", "pi did not become ready")),
    },
  });
  const { sent, tool } = loadSession(host, calls);

  const result = await runTask(tool, "blocked task");

  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "spawn_failed" });
  const text = firstText(result);
  expect(text).toContain("w1:p1");
  expect(text).toContain("trust");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
  expect(sent).toHaveLength(0);

  ready = true;

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
});

it("delivers one done result", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "say hello"));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  const message = sent[0]?.message;
  expect(message?.customType).toBe("subagent_result");
  expect(message?.display).toBe(true);
  expect(message?.content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(message?.content).toContain("hello");
  expect(sent[0]?.options).toEqual({ triggerTurn: true });
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(5000);

  expect(sent).toHaveLength(1);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("keeps a finished run live and delivers the next turn", async () => {
  let snapshot: AgentSnapshot = { status: "idle", completionSeq: 1 };
  const { calls, sent, tool } = loadTimedSession(async () => snapshot);

  const started = parseStarted(await runTask(tool, "say hello"));
  writeFileSync(started.sessionFile, `${assistantLine("first")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("first");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  const reply = await sendTask(tool, "worker-1", "next turn");

  expect(reply.isError).toBe(false);
  expect(firstText(reply)).toBe('{"state":"sent","name":"worker-1"}');

  snapshot = { status: "idle", completionSeq: 2 };
  writeFileSync(started.sessionFile, `${assistantLine("second")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.message.content).toContain("second");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("closes the tab when auto-exit is true", async () => {
  writeConfig({ maxConcurrent: 1 });
  writeProfile("worker.md", "---\nauto-exit: true\n---\n\nWorker body.\n");
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "say hello"));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
  expect(calls.indexOf("sendMessage")).toBeLessThan(calls.indexOf("closeTabIfOnlyPane"));

  const next = await runTask(tool, "next task");

  expect(next.isError).toBe(false);
  expect(parseStarted(next).name).toBe("worker-2");
});

it("ignores completion seq zero", async () => {
  let snapshot: AgentSnapshot = { status: "idle", completionSeq: 0 };
  const { calls, sent, tool } = loadTimedSession(async () => snapshot);

  const started = parseStarted(await runTask(tool, "status first"));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(calls.filter((call) => call === "listAgents")).toHaveLength(1);
  expect(sent).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  snapshot = { status: "idle", completionSeq: 1 };
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content.startsWith("[subagent worker-1] done")).toBe(true);
});

it("polls all runs with one agent list call", async () => {
  writeConfig({ maxConcurrent: 3 });
  const { calls, tool } = loadTimedSession(async () => ({ status: "working", completionSeq: 0 }));

  for (let index = 1; index <= 3; index++) {
    await runTask(tool, `task ${index}`);
  }

  await vi.advanceTimersByTimeAsync(1000);

  expect(calls.filter((call) => call === "listAgents")).toHaveLength(1);
});

it("matches a renamed agent by pane id", async () => {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const fake = fakeHost();
  const { sent, tool } = loadSession(fake.host);
  const started = parseStarted(await runTask(tool, "inspect the repo"));
  let seq = 1;
  fake.setListAgents(async () => [
    { name: `renamed-worker-${seq}`, paneId: started.paneId, status: "idle", completionSeq: seq },
  ]);

  writeFileSync(started.sessionFile, `${assistantLine("first answer")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("first answer");

  seq = 2;
  writeFileSync(started.sessionFile, `${assistantLine("second answer")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.message.content).toContain("second answer");
});

it("does not overlap polls", async () => {
  let resolvePoll: (snapshot: AgentSnapshot) => void = () => {};
  let polls = 0;
  const { tool } = loadTimedSession(async () => {
    polls += 1;
    if (polls === 1) {
      return new Promise<AgentSnapshot>((resolve) => {
        resolvePoll = resolve;
      });
    }
    return { status: "working", completionSeq: 0 };
  });

  await runTask(tool, "slow task");

  await vi.advanceTimersByTimeAsync(3000);
  expect(polls).toBe(1);

  resolvePoll({ status: "working", completionSeq: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(polls).toBe(2);
});

it("keeps polling other runs when delivery fails", async () => {
  writeConfig({ maxConcurrent: 2 });
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const fake = fakeHost();
  const { sent, setSendFailures, tool } = loadSession(fake.host);
  fake.setAgents(async () => ({ status: "idle", completionSeq: 1 }));
  const first = parseStarted(await runTask(tool, "first task"));
  const second = parseStarted(await runTask(tool, "second task"));
  writeFileSync(first.sessionFile, `${assistantLine("first answer")}\n`);
  writeFileSync(second.sessionFile, `${assistantLine("second answer")}\n`);
  setSendFailures(1);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("second answer");
});

it("releases the slot after done", async () => {
  writeConfig({ maxConcurrent: 4 });
  writeProfile("worker.md", "---\nauto-exit: true\n---\n\nWorker body.\n");
  const { sent, tool } = loadTimedSession(async (name) =>
    name === "worker-1" ? { status: "idle", completionSeq: 1 } : { status: "working", completionSeq: 0 },
  );

  const started: RunStarted[] = [];
  for (let index = 1; index <= 4; index++) {
    started.push(parseStarted(await runTask(tool, `task ${index}`)));
  }
  const first = started[0];
  if (!first) {
    throw new Error("expected a first run");
  }
  writeFileSync(first.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  const fifth = await runTask(tool, "after release");

  expect(fifth.isError).toBe(false);
  expect(parseStarted(fifth).name).toBe("worker-5");
});

it("delivers a done result from the exit receipt", async () => {
  const { sent, tool } = loadTimedSession(async () => null);

  const started = parseStarted(await runTask(tool, "finished task"));
  writeFileSync(started.sessionFile, `${assistantLine("final answer")}\n`);
  writeExitReceipt(started.sessionFile, "quit");

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(sent[0]?.message.content).toContain("final answer");
});

it("reports a quitted run when the receipt has no final answer", async () => {
  const { sent, tool } = loadTimedSession(async () => null);

  const started = parseStarted(await runTask(tool, "vanished task"));
  writeExitReceipt(started.sessionFile, "quit");

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("unknown (quitted)");
});

it("reports pane exited without a receipt", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => null);

  const started = parseStarted(await runTask(tool, "vanished task"));

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content).toContain("unknown (pane_exited)");
  expect(content).toContain(`Session: ${started.sessionFile}`);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(5000);
  expect(sent).toHaveLength(1);

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
});

it("does not repeat a delivered run", async () => {
  let snapshot: AgentSnapshot | null = { status: "idle", completionSeq: 1 };
  const { sent, tool } = loadTimedSession(async () => snapshot);

  const started = parseStarted(await runTask(tool, "say hello"));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  snapshot = null;
  writeExitReceipt(started.sessionFile, "quit");
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
});

it("reports three consecutive poll failures", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => {
    throw new Error("herdr answered with garbage");
  });

  await runTask(tool, "flaky task");

  await vi.advanceTimersByTimeAsync(2000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("unknown (poll_failed)");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
});

it("resets poll failure count on success", async () => {
  let polls = 0;
  const { calls, sent, tool } = loadTimedSession(async () => {
    polls += 1;
    if (polls <= 2) {
      throw new Error("temporary herdr error");
    }
    return { status: "idle", completionSeq: 1 };
  });

  const started = parseStarted(await runTask(tool, "eventual success"));
  writeFileSync(started.sessionFile, `${assistantLine("finished")}\n`);

  await vi.advanceTimersByTimeAsync(3000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).not.toContain("unknown");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("waits while the worker is blocked in a tool call", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "done", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "ask the human"));
  writeFileSync(started.sessionFile, `${pendingAskLine()}\n`);

  await vi.advanceTimersByTimeAsync(5000);
  expect(sent).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  writeFileSync(started.sessionFile, `${assistantLine("answered")}\n`);
  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).toContain("answered");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("asks once per blocked episode", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "blocked", completionSeq: 0 }));

  await runTask(tool, "ask the human");
  await vi.advanceTimersByTimeAsync(3000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.customType).toBe("subagent_question");
  expect(sent[0]?.message.content).toContain("[subagent worker-1] blocked (question)");
  expect(sent[0]?.message.content).toContain("Do you want to continue?");
  expect(calls.filter((call) => call === "readAgent")).toHaveLength(1);
});

it("asks again after leaving blocked", async () => {
  let snapshot: AgentSnapshot = { status: "blocked", completionSeq: 0 };
  const { sent, tool } = loadTimedSession(async () => snapshot);

  await runTask(tool, "ask the human");
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  snapshot = { status: "idle", completionSeq: 0 };
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  snapshot = { status: "blocked", completionSeq: 0 };
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(2);
});

it("does not read the pane when idle", async () => {
  const { calls, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 0 }));

  await runTask(tool, "just work");
  await vi.advanceTimersByTimeAsync(3000);

  expect(calls.filter((call) => call === "readAgent")).toHaveLength(0);
});

it("settles after three read failures", async () => {
  const { fake, sent, tool } = loadTimedSession(async () => ({ status: "blocked", completionSeq: 0 }));
  fake.setReadAgent(async () => {
    throw new Error("pane is gone");
  });

  await runTask(tool, "ask the human");
  await vi.advanceTimersByTimeAsync(2000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content).toContain("unknown (poll_failed)");
});

it("does not repeat a question when delivery fails", async () => {
  const { sent, setSendFailures, tool } = loadTimedSession(async () => ({ status: "blocked", completionSeq: 0 }));
  setSendFailures(1);

  await runTask(tool, "ask the human");
  await vi.advanceTimersByTimeAsync(3000);

  expect(sent).toHaveLength(0);
});

it("asks again after a revived blocked run", async () => {
  const { fake, sent, tool } = loadTimedSession(async () => ({ status: "blocked", completionSeq: 0 }));
  const started = parseStarted(await runTask(tool, "ask the human"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  fake.setListAgents(async () => {
    throw new Error("herdr down");
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(sent).toHaveLength(2);
  expect(sent[1]?.message.content).toContain("unknown (poll_failed)");

  fake.setListAgents(async () => [{ name: started.name, paneId: started.paneId, status: "blocked", completionSeq: 0 }]);
  const resumed = await sendTask(tool, started.name, "keep going");
  expect(resumed.isError).toBe(false);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(3);
  expect(sent[2]?.message.customType).toBe("subagent_question");
});

it("reports unreadable result as unknown", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "no output"));

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(400);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content).toContain("unknown (no_result)");
  expect(content).toContain(`Session: ${started.sessionFile}`);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
});

it("truncates long result", async () => {
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "write a long report"));
  const head = "h".repeat(16384);
  const tail = "TAIL_MARKER".padEnd(616, "t");
  writeFileSync(started.sessionFile, `${assistantLine(`${head}${tail}`)}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).toContain(head);
  expect(content).not.toContain("TAIL_MARKER");
  expect(content).toContain("truncated");
  expect(content).toContain(started.sessionFile);

  await vi.advanceTimersByTimeAsync(5000);
  expect(sent).toHaveLength(1);
});

it("does not split surrogate pairs when truncating", async () => {
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "emoji report"));
  const head = `${"h".repeat(16383)}😀`;
  writeFileSync(started.sessionFile, `${assistantLine(`${head}${"z".repeat(100)}`)}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content).toContain("h".repeat(16383));
  expect(content).toContain("truncated");
  expect(content).not.toMatch(/\p{Cs}/u);
});

async function expectDoneDespiteClose(closeTab: () => CloseTabResult | Error, closeFailed = false) {
  writeProfile("worker.md", "---\nauto-exit: true\n---\n\nWorker body.\n");
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }), closeTab);

  const started = parseStarted(await runTask(tool, "say hello"));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(closeFailed ? 2 : 1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).toContain("hello");
  expect(content).not.toContain("error");
  if (closeFailed) {
    expect(sent[1]?.message.content).toBe(
      `[subagent worker-1] unknown (close_failed)\n\nSession: ${started.sessionFile}`,
    );
  }
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
  expect(parseStarted(next).name).toBe("worker-2");
}

it("keeps tab when close is refused", async () => {
  await expectDoneDespiteClose(() => "kept");
});

it("reports a failed close", async () => {
  await expectDoneDespiteClose(() => new Error("herdr tab close failed"), true);
});

it("stops after session shutdown", async () => {
  const { calls, sent, shutdownSession, tool } = loadTimedSession(async () => ({
    status: "working",
    completionSeq: 0,
  }));

  await runTask(tool, "long task");

  await shutdownSession();
  await vi.advanceTimersByTimeAsync(5000);

  expect(sent).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("closes children on matching reasons", async () => {
  writeConfig({ closeChildrenOn: ["quit"] });
  const { calls, sent, shutdownSession, tool } = loadTimedSession(async () => ({
    status: "working",
    completionSeq: 0,
  }));

  await runTasks(tool, 2);
  await shutdownSession("quit");
  await vi.advanceTimersByTimeAsync(5000);

  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(2);
  expect(sent.filter((message) => message.message.content.includes("unknown"))).toHaveLength(0);
});

it("keeps children when the reason does not match", async () => {
  writeConfig({ closeChildrenOn: ["resume"] });
  const { calls, shutdownSession, tool } = loadTimedSession(async () => ({
    status: "working",
    completionSeq: 0,
  }));

  await runTask(tool, "long task");
  await shutdownSession("quit");

  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});

it("coalesces results in one window", async () => {
  writeConfig({ aggregateWindowMs: 500 });
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));
  const first = parseStarted(await runTask(tool, "first task"));
  const second = parseStarted(await runTask(tool, "second task"));
  writeFileSync(first.sessionFile, `${assistantLine("first answer")}\n`);
  writeFileSync(second.sessionFile, `${assistantLine("second answer")}\n`);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(500);
  expect(sent).toHaveLength(1);
  const content = sent[0]?.message.content ?? "";
  expect(content).toContain("[subagent worker-1] done");
  expect(content).toContain("[subagent worker-2] done");
});

it("reports a deferred delivery failure", async () => {
  writeConfig({ aggregateWindowMs: 500 });
  const { notifications, sent, setSendFailures, tool } = loadTimedSession(async () => ({
    status: "idle",
    completionSeq: 1,
  }));
  const started = parseStarted(await runTask(tool, "first task"));
  writeFileSync(started.sessionFile, `${assistantLine("first answer")}\n`);
  setSendFailures(1);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(500);
  expect(sent).toHaveLength(0);
  expect(notifications.some((notification) => notification.message.includes("result delivery failed"))).toBe(true);
});

it("sends separately when aggregation is off", async () => {
  writeConfig({ aggregateWindowMs: 0 });
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));
  const first = parseStarted(await runTask(tool, "first task"));
  const second = parseStarted(await runTask(tool, "second task"));
  writeFileSync(first.sessionFile, `${assistantLine("first answer")}\n`);
  writeFileSync(second.sessionFile, `${assistantLine("second answer")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(2);
});

it("flushes at the window boundary", async () => {
  writeConfig({ aggregateWindowMs: 300 });
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));
  const started = parseStarted(await runTask(tool, "first task"));
  writeFileSync(started.sessionFile, `${assistantLine("first answer")}\n`);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(299);
  expect(sent).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(1);
  expect(sent).toHaveLength(1);
});

it("keeps a tab with several panes", async () => {
  writeConfig({ closeChildrenOn: ["quit"] });
  const { notifications, shutdownSession, tool } = loadTimedSession(
    async () => ({ status: "working", completionSeq: 0 }),
    () => "kept",
  );

  await runTask(tool, "long task");
  await shutdownSession("quit");

  expect(notifications).toEqual([{ message: 'child "worker-1" kept: its tab was not a single pane', type: "warning" }]);
});

it("shuts down after settle when auto-exit is on", async () => {
  const settled = loadAutoExitChild();
  settled.fake.settle();
  expect(settled.fake.shutdowns).toBe(1);

  const queued = loadAutoExitChild();
  writeInbox(queued.sessionFile, [["a.md", "more work"]]);
  queued.fake.settle();
  expect(queued.fake.shutdowns).toBe(0);

  const prompted = loadAutoExitChild();
  prompted.fake.promptStart();
  prompted.fake.settle();
  expect(prompted.fake.shutdowns).toBe(0);
});

it("does not shut down without the env", async () => {
  const child = loadAutoExitChild({ env: null });

  child.fake.settle();

  expect(child.fake.shutdowns).toBe(0);
});

it("writes an exit receipt for a child session", async () => {
  const sessionFile = childSessionFile();
  writeInbox(sessionFile, [["a.md", "queued"]]);
  const child = loadChild(sessionFile);

  await child.shutdownSession("quit");

  expect(JSON.parse(readFileSync(`${sessionFile}.exit`, "utf8"))).toEqual({ reason: "quit" });
});

it("skips the receipt when there is no inbox", async () => {
  const sessionFile = childSessionFile();
  const child = loadChild(sessionFile);

  await child.shutdownSession("quit");

  expect(existsSync(`${sessionFile}.exit`)).toBe(false);
});

it("delivers inbox messages in order", async () => {
  vi.useFakeTimers();
  const sessionFile = childSessionFile();
  writeInbox(sessionFile, [
    ["b.md", "second"],
    ["a.md", "first"],
  ]);
  const child = loadChild(sessionFile);

  await vi.advanceTimersByTimeAsync(250);

  expect(child.userMessages).toEqual([
    { content: "first", options: undefined },
    { content: "second", options: undefined },
  ]);
  expect(existsSync(join(`${sessionFile}.inbox`, ".delivered", "a.md"))).toBe(true);
  expect(existsSync(join(`${sessionFile}.inbox`, ".delivered", "b.md"))).toBe(true);

  await vi.advanceTimersByTimeAsync(250);

  expect(child.userMessages).toHaveLength(2);
});

it("steers while the child is busy", async () => {
  vi.useFakeTimers();
  const sessionFile = childSessionFile();
  writeInbox(sessionFile, [["a.md", "busy"]]);
  const child = loadChild(sessionFile, { isIdle: () => false });

  await vi.advanceTimersByTimeAsync(250);

  expect(child.userMessages).toEqual([{ content: "busy", options: { deliverAs: "steer" } }]);
});

it("does not poll without an inbox", async () => {
  vi.useFakeTimers();
  const child = loadChild(childSessionFile());

  await vi.advanceTimersByTimeAsync(1000);

  expect(child.userMessages).toEqual([]);
  expect(child.notifications).toEqual([]);
});

it("stops inbox polling on shutdown", async () => {
  vi.useFakeTimers();
  const sessionFile = childSessionFile();
  writeInbox(sessionFile, [["a.md", "before shutdown"]]);
  const child = loadChild(sessionFile);

  await vi.advanceTimersByTimeAsync(250);
  writeInbox(sessionFile, [["b.md", "after shutdown"]]);
  await child.shutdownSession();
  await vi.advanceTimersByTimeAsync(1000);

  expect(child.userMessages).toEqual([{ content: "before shutdown", options: undefined }]);
});

it("stops inbox polling after three failures", async () => {
  vi.useFakeTimers();
  const sessionFile = childSessionFile();
  writeInbox(sessionFile, [["a.md", "never delivered"]]);
  const child = loadChild(sessionFile);
  child.setSendUserMessage(() => {
    throw new Error("not ready");
  });

  await vi.advanceTimersByTimeAsync(750);

  expect(child.userMessages).toHaveLength(3);
  expect(child.notifications).toEqual([{ message: expect.stringContaining("inbox"), type: "error" }]);

  await vi.advanceTimersByTimeAsync(2000);

  expect(child.userMessages).toHaveLength(3);
  expect(child.notifications).toHaveLength(1);
});
