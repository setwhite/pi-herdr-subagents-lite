import { writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExtension, type ExtensionRegistrar, type SubagentTool } from "../src/extension/index.ts";
import { type AgentSnapshot, type HerdrHost, HerdrHostError, type StartAgentInput } from "../src/herdr/index.ts";
import { readLastAssistantText } from "../src/session/index.ts";
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
  return { pi, sent, startSession, tools };
}

function fakeHost(startFailures = 0, events?: string[]) {
  const calls: string[] = events ?? [];
  const tabs: Array<{ cwd: string; label: string }> = [];
  const renamedTabs: Array<{ tabId: string; label: string }> = [];
  const agents: StartAgentInput[] = [];
  let panes = 0;
  let starts = 0;
  let getAgentImpl: (name: string) => Promise<AgentSnapshot | null> = async () => null;
  const host: HerdrHost = {
    async createTab(input) {
      calls.push("createTab");
      tabs.push(input);
      panes += 1;
      return { tabId: `w1:t${panes}`, paneId: `w1:p${panes}` };
    },
    async renameTab(input) {
      calls.push("renameTab");
      renamedTabs.push(input);
    },
    async startAgent(input) {
      calls.push("startAgent");
      agents.push(input);
      starts += 1;
      if (starts <= startFailures) {
        throw new HerdrHostError("name_taken", "taken");
      }
    },
    async getAgent(name) {
      calls.push("getAgent");
      return getAgentImpl(name);
    },
    async closeTabIfOnlyPane() {
      calls.push("closeTabIfOnlyPane");
      return "closed";
    },
  };
  return {
    agents,
    calls,
    host,
    renamedTabs,
    setGetAgent(impl: (name: string) => Promise<AgentSnapshot | null>) {
      getAgentImpl = impl;
    },
    tabs,
  };
}

function loadSession(host: HerdrHost, events: string[] = []) {
  const { pi, sent, startSession, tools } = fakePi(events);
  createExtension({ host, readLastAssistantText })(pi);
  startSession();
  const tool = tools[0];
  if (tools.length !== 1 || !tool) {
    throw new Error(`expected one registered tool, got ${tools.length}`);
  }
  return { sent, startSession, tool };
}

function loadTool(host: HerdrHost) {
  return loadSession(host).tool;
}

function runTask(tool: SubagentTool, task: string) {
  return tool.execute("call-1", { action: "run", task }, undefined, undefined, {} as never);
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

const tempDirs = new Set<string>();

beforeEach(() => {
  delete process.env.HERDR_ENV;
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
  delete process.env.HERDR_ENV;
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
  expect(Object.keys(schema.properties)).toEqual(["action", "task"]);
  expect(schema.properties.action).toMatchObject({ const: "run" });
  expect(schema.properties.task).toMatchObject({ type: "string", minLength: 1 });
  expect(schema.required).toEqual(["action", "task"]);
  expect(schema.additionalProperties).toBe(false);
});

it("rejects outside herdr", async () => {
  const { calls, host } = fakeHost();
  const tool = loadTool(host);

  const result = await tool.execute(
    "call-1",
    { action: "run", task: "inspect the repo" },
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

  expect(description).toContain("background worker");
  expect(description).toContain("asynchronously");
  expect(snippet).toContain("background worker");
  expect(snippet).toContain("asynchronously");
  expect(guidelines).toContain("subagent_result");
});

it("launches a worker", async () => {
  process.env.HERDR_ENV = "1";
  const { agents, host, tabs } = fakeHost();
  const tool = loadTool(host);

  const result = await runTask(tool, "inspect the repo");
  const started = parseStarted(result);

  expect(result.isError).toBe(false);
  expect(started).toMatchObject({ state: "running", name: "worker-1", paneId: "w1:p1" });
  expect(tabs).toEqual([{ cwd: process.cwd(), label: "worker-1" }]);

  const agent = agents[0];
  if (!agent) {
    throw new Error("expected startAgent to be called");
  }
  expect(agent).toMatchObject({ name: "worker-1", paneId: started.paneId, sessionFile: started.sessionFile });
  const brief = await readFile(agent.briefFile, "utf8");
  expect(brief).toContain("inspect the repo");
  expect(brief).toContain("You are a worker subagent");
  expect(brief).toContain("Do not spawn subagents");
  tempDirs.add(dirname(agent.briefFile));
});

it("rejects the fifth active worker", async () => {
  process.env.HERDR_ENV = "1";
  const { agents, calls, host, tabs } = fakeHost();
  const tool = loadTool(host);

  for (let index = 1; index <= 4; index++) {
    const result = await runTask(tool, `task ${index}`);
    expect(result.isError).toBe(false);
  }

  const result = await runTask(tool, "task 5");
  expect(result.isError).toBe(true);
  expect(result.details).toMatchObject({ code: "max_concurrent" });
  const text = firstText(result);
  expect(text.startsWith("max_concurrent: ")).toBe(true);
  for (const name of ["worker-1", "worker-2", "worker-3", "worker-4"]) {
    expect(text).toContain(name);
  }
  expect(tabs).toHaveLength(4);
  expect(calls.filter((call) => call === "createTab")).toHaveLength(4);

  const agent = agents[0];
  if (agent) {
    tempDirs.add(dirname(agent.briefFile));
  }
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

it("keeps label and paths consistent on name_taken", async () => {
  process.env.HERDR_ENV = "1";
  const { agents, host, renamedTabs } = fakeHost(1);
  const tool = loadTool(host);

  const started = parseStarted(await runTask(tool, "retry task"));

  expect(started.name).toBe("worker-2");
  expect(renamedTabs).toEqual([{ tabId: "w1:t1", label: "worker-2" }]);
  expect(agents).toHaveLength(2);
  expect(agents[0]?.sessionFile).toBe(agents[1]?.sessionFile);
  expect(agents[0]?.briefFile).toBe(agents[1]?.briefFile);

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

it("delivers one done result", async () => {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const { host, setGetAgent } = fakeHost(0, calls);
  setGetAgent(async () => ({ status: "idle", completionSeq: 1 }));
  const { sent, tool } = loadSession(host, calls);

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
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const { host, setGetAgent } = fakeHost(0, calls);
  let snapshot: AgentSnapshot = { status: "idle", completionSeq: 0 };
  setGetAgent(async () => snapshot);
  const { sent, tool } = loadSession(host, calls);

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
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const { host, setGetAgent } = fakeHost(0, calls);
  let resolvePoll: (snapshot: AgentSnapshot) => void = () => {};
  let polls = 0;
  setGetAgent(async () => {
    polls += 1;
    if (polls === 1) {
      return new Promise<AgentSnapshot>((resolve) => {
        resolvePoll = resolve;
      });
    }
    return { status: "working", completionSeq: 0 };
  });
  const { tool } = loadSession(host, calls);

  const started = parseStarted(await runTask(tool, "slow task"));
  tempDirs.add(dirname(started.sessionFile));

  await vi.advanceTimersByTimeAsync(3000);
  expect(polls).toBe(1);

  resolvePoll({ status: "working", completionSeq: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(polls).toBe(2);
});

it("releases the slot after done", async () => {
  vi.useFakeTimers();
  process.env.HERDR_ENV = "1";
  const calls: string[] = [];
  const { host, setGetAgent } = fakeHost(0, calls);
  setGetAgent(async (name) =>
    name === "worker-1" ? { status: "idle", completionSeq: 1 } : { status: "working", completionSeq: 0 },
  );
  const { sent, tool } = loadSession(host, calls);

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
