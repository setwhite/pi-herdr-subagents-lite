import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/index.ts";
import { createExtension, type ExtensionRegistrar, type SubagentTool } from "../src/extension/index.ts";
import { type AgentSnapshot, type HerdrHost, HerdrHostError, type StartAgentInput } from "../src/herdr/index.ts";
import { loadProfiles } from "../src/profile/index.ts";
import { readLastAssistant } from "../src/session/index.ts";
import type { RunStarted } from "../src/subagent/index.ts";

interface SentMessage {
  message: { customType: string; content: string; display: boolean };
  options: { triggerTurn?: boolean } | undefined;
}

function fakePi(events: string[] = []) {
  const tools: SubagentTool[] = [];
  const handlers = new Map<string, Array<() => void>>();
  const sent: SentMessage[] = [];
  const pi: ExtensionRegistrar = {
    on(event, handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    sendMessage(message, options) {
      events.push("sendMessage");
      sent.push({ message, options });
    },
  };
  const startSession = () => {
    for (const handler of handlers.get("session_start") ?? []) {
      handler();
    }
  };
  const shutdownSession = () => {
    for (const handler of handlers.get("session_shutdown") ?? []) {
      handler();
    }
  };
  return { pi, sent, shutdownSession, startSession, tools };
}

interface FakeHostFailures {
  createTab?: (attempt: number) => Error | undefined;
  startAgent?: (attempt: number) => Error | undefined;
}

function fakeHost(
  options: { events?: string[]; failures?: FakeHostFailures; closeTab?: () => "closed" | "kept" | Error } = {},
) {
  const calls: string[] = options.events ?? [];
  const tabs: Array<{ cwd: string; label: string }> = [];
  const renamedTabs: Array<{ tabId: string; label: string }> = [];
  const renamedPanes: Array<{ paneId: string; label: string }> = [];
  const agents: StartAgentInput[] = [];
  let panes = 0;
  let starts = 0;
  let getAgentImpl: (name: string) => Promise<AgentSnapshot | null> = async () => null;
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
      starts += 1;
      const error = options.failures?.startAgent?.(starts);
      if (error) {
        throw error;
      }
    },
    async getAgent(name) {
      calls.push("getAgent");
      return getAgentImpl(name);
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
    renamedPanes,
    renamedTabs,
    setGetAgent(impl: (name: string) => Promise<AgentSnapshot | null>) {
      getAgentImpl = impl;
    },
    tabs,
  };
}

let agentDir = "";

function configFile(): string {
  return join(agentDir, "pi-herdr-subagents-lite", "config.json");
}

function writeConfig(value: unknown) {
  mkdirSync(dirname(configFile()), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(value));
}

function writeProfile(fileName: string, content: string) {
  const file = join(agentDir, "agents", fileName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function registerExtension(pi: ExtensionRegistrar, host: HerdrHost) {
  createExtension({ host, readLastAssistant, loadConfig, loadProfiles })(pi);
}

function loadSession(host: HerdrHost, events: string[] = []) {
  const { pi, sent, shutdownSession, startSession, tools } = fakePi(events);
  registerExtension(pi, host);
  startSession();
  const tool = tools[0];
  if (tools.length !== 1 || !tool) {
    throw new Error(`expected one registered tool, got ${tools.length}`);
  }
  return { sent, shutdownSession, startSession, tool };
}

function loadTool(host: HerdrHost) {
  return loadSession(host).tool;
}

function loadTimedSession(
  getAgent: (name: string) => Promise<AgentSnapshot | null>,
  closeTab?: () => "closed" | "kept" | Error,
) {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const fake = fakeHost({ events: calls, closeTab });
  fake.setGetAgent(getAgent);
  return { ...loadSession(fake.host, calls), calls };
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
  const first = started[0];
  if (!first) {
    throw new Error("expected a first run");
  }
  tempDirs.add(dirname(first.sessionFile));
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

function startRun(
  fake: ReturnType<typeof fakeHost>,
  options: { profile?: string; task?: string } = {},
): Promise<{ agent: StartAgentInput; started: RunStarted }> {
  return runTask(loadTool(fake.host), options.task ?? "inspect the repo", options.profile).then((result) => {
    const started = parseStarted(result);
    tempDirs.add(dirname(started.sessionFile));
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
  agentDir = mkdtempSync(join(tmpdir(), "pi-herdr-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeProfile("worker.md", "Worker body.\n");
  tempDirs.add(agentDir);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
  delete process.env.HERDR_ENV;
  delete process.env.PI_CODING_AGENT_DIR;
});

it("registers the subagent schema", () => {
  const tool = loadTool(fakeHost().host);

  expect(tool.name).toBe("subagent");
  expect(tool.label).toBe("Subagent");

  const schema = tool.parameters as unknown as {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.type).toBe("object");
  expect(Object.keys(schema.properties)).toEqual(["action", "profile", "task"]);
  expect(schema.properties.action).toMatchObject({ const: "run" });
  expect(schema.properties.profile).toMatchObject({ type: "string", minLength: 1 });
  expect(schema.properties.task).toMatchObject({ type: "string", minLength: 1 });
  expect(schema.required).toEqual(["action", "profile", "task"]);
  expect(schema.additionalProperties).toBe(false);
});

it("reports config errors without registering", () => {
  writeConfig({ nope: 1 });
  const { pi, tools } = fakePi();

  expect(() => registerExtension(pi, fakeHost().host)).toThrow(/nope/);
  expect(tools).toHaveLength(0);
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
      text: "not_in_herdr: subagent requires running pi inside a herdr pane; there is no fallback.",
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
  expect(fake.tabs).toEqual([{ cwd: process.cwd(), label: "worker-1" }]);
  expect(agent).toMatchObject({ name: "worker-1", paneId: started.paneId, sessionFile: started.sessionFile });
  const brief = await readFile(agent.briefFile, "utf8");
  expect(brief).toContain("inspect the repo");
  expect(brief).toContain("You are a worker subagent");
  expect(brief).toContain("Do not spawn subagents");
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

  expect(nested.tabs).toEqual([{ cwd: join(process.cwd(), "sub"), label: "worker-1" }]);

  writeProfile("worker.md", "---\ndescription: no cwd\n---\n\nWorker body.\n");
  const plain = fakeHost();

  await startRun(plain);

  expect(plain.tabs).toEqual([{ cwd: process.cwd(), label: "worker-1" }]);
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

  const first = parseStarted(await runTask(limited.tool, "task 1"));
  const second = parseStarted(await runTask(limited.tool, "task 2"));
  tempDirs.add(dirname(first.sessionFile));

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
  const { agents, host } = fakeHost();
  const { startSession, tool } = loadSession(host);

  expect(parseStarted(await runTask(tool, "first task")).name).toBe("worker-1");
  startSession();
  expect(parseStarted(await runTask(tool, "next session")).name).toBe("worker-1");

  for (const agent of agents) {
    tempDirs.add(dirname(agent.briefFile));
  }
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
  expect(agents[0]?.sessionFile).toBe(agents[1]?.sessionFile);
  expect(agents[0]?.briefFile).toBe(agents[1]?.briefFile);
  expect(sent).toHaveLength(0);

  const agent = agents[0];
  if (agent) {
    tempDirs.add(dirname(agent.briefFile));
  }
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
  expect(sent).toHaveLength(0);

  nameTaken = false;

  expect((await runTask(tool, "next task")).isError).toBe(false);

  const agent = agents[0];
  if (agent) {
    tempDirs.add(dirname(agent.briefFile));
  }
});

it("uses distinct child sessions", async () => {
  process.env.HERDR_ENV = "1";
  const { agents, host } = fakeHost();
  const tool = loadTool(host);

  const first = parseStarted(await runTask(tool, "first task"));
  const second = parseStarted(await runTask(tool, "second task"));

  expect(first.name).toBe("worker-1");
  expect(second.name).toBe("worker-2");
  expect(second.sessionFile).not.toBe(first.sessionFile);

  const agent = agents[0];
  if (agent) {
    tempDirs.add(dirname(agent.briefFile));
  }
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
  tempDirs.add(dirname(parseStarted(next).sessionFile));
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
  tempDirs.add(dirname(parseStarted(next).sessionFile));
});

it("delivers one done result", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "say hello"));
  tempDirs.add(dirname(started.sessionFile));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  const message = sent[0]?.message;
  expect(message?.customType).toBe("subagent_result");
  expect(message?.display).toBe(true);
  expect(message?.content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(message?.content).toContain("hello");
  expect(sent[0]?.options).toEqual({ triggerTurn: true });
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
  expect(calls.indexOf("sendMessage")).toBeLessThan(calls.indexOf("closeTabIfOnlyPane"));

  await vi.advanceTimersByTimeAsync(5000);

  expect(sent).toHaveLength(1);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
});

it("ignores completion seq zero", async () => {
  let snapshot: AgentSnapshot = { status: "idle", completionSeq: 0 };
  const { calls, sent, tool } = loadTimedSession(async () => snapshot);

  const started = parseStarted(await runTask(tool, "status first"));
  tempDirs.add(dirname(started.sessionFile));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  expect(calls.filter((call) => call === "getAgent")).toHaveLength(1);
  expect(sent).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  snapshot = { status: "idle", completionSeq: 1 };
  await vi.advanceTimersByTimeAsync(1000);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.message.content.startsWith("[subagent worker-1] done")).toBe(true);
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

  const started = parseStarted(await runTask(tool, "slow task"));
  tempDirs.add(dirname(started.sessionFile));

  await vi.advanceTimersByTimeAsync(3000);
  expect(polls).toBe(1);

  resolvePoll({ status: "working", completionSeq: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(polls).toBe(2);
});

it("releases the slot after done", async () => {
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
  tempDirs.add(dirname(first.sessionFile));
  writeFileSync(first.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toHaveLength(1);

  const fifth = await runTask(tool, "after release");

  expect(fifth.isError).toBe(false);
  expect(parseStarted(fifth).name).toBe("worker-5");
});

it("reports missing agent as unknown", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => null);

  const started = parseStarted(await runTask(tool, "vanished task"));
  tempDirs.add(dirname(started.sessionFile));

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content).toContain("unknown (agent_missing)");
  expect(content).toContain(`Session: ${started.sessionFile}`);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);

  await vi.advanceTimersByTimeAsync(5000);
  expect(sent).toHaveLength(1);

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
  tempDirs.add(dirname(parseStarted(next).sessionFile));
});

it("reports three consecutive poll failures", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => {
    throw new Error("herdr answered with garbage");
  });

  const started = parseStarted(await runTask(tool, "flaky task"));
  tempDirs.add(dirname(started.sessionFile));

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
  tempDirs.add(dirname(started.sessionFile));
  writeFileSync(started.sessionFile, `${assistantLine("finished")}\n`);

  await vi.advanceTimersByTimeAsync(3000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).not.toContain("unknown");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
});

it("waits while the worker is blocked in a tool call", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "done", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "ask the human"));
  tempDirs.add(dirname(started.sessionFile));
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
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);
});

it("reports unreadable result as unknown", async () => {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "no output"));
  tempDirs.add(dirname(started.sessionFile));

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
  tempDirs.add(dirname(parseStarted(next).sessionFile));
});

it("truncates long result", async () => {
  const { sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }));

  const started = parseStarted(await runTask(tool, "write a long report"));
  tempDirs.add(dirname(started.sessionFile));
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
  tempDirs.add(dirname(started.sessionFile));
  const head = `${"h".repeat(16383)}😀`;
  writeFileSync(started.sessionFile, `${assistantLine(`${head}${"z".repeat(100)}`)}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content).toContain("h".repeat(16383));
  expect(content).toContain("truncated");
  expect(content).not.toMatch(/\p{Cs}/u);
});

async function expectDoneDespiteClose(closeTab: () => "closed" | "kept" | Error) {
  const { calls, sent, tool } = loadTimedSession(async () => ({ status: "idle", completionSeq: 1 }), closeTab);

  const started = parseStarted(await runTask(tool, "say hello"));
  tempDirs.add(dirname(started.sessionFile));
  writeFileSync(started.sessionFile, `${assistantLine("hello")}\n`);

  await vi.advanceTimersByTimeAsync(1000);

  const content = sent[0]?.message.content ?? "";
  expect(sent).toHaveLength(1);
  expect(content.startsWith("[subagent worker-1] done")).toBe(true);
  expect(content).toContain("hello");
  expect(content).not.toContain("error");
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(1);

  const next = await runTask(tool, "next task");
  expect(next.isError).toBe(false);
  expect(parseStarted(next).name).toBe("worker-2");
  tempDirs.add(dirname(parseStarted(next).sessionFile));
}

it("keeps tab when close is refused", async () => {
  await expectDoneDespiteClose(() => "kept");
});

it("keeps tab when close throws", async () => {
  await expectDoneDespiteClose(() => new Error("herdr tab close failed"));
});

it("stops after session shutdown", async () => {
  const { calls, sent, shutdownSession, tool } = loadTimedSession(async () => ({
    status: "working",
    completionSeq: 0,
  }));

  const started = parseStarted(await runTask(tool, "long task"));
  tempDirs.add(dirname(started.sessionFile));

  shutdownSession();
  await vi.advanceTimersByTimeAsync(5000);

  expect(sent).toHaveLength(0);
  expect(calls.filter((call) => call === "closeTabIfOnlyPane")).toHaveLength(0);
});
