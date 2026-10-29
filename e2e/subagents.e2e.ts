import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errors,
  HerdrE2e,
  killProcess,
  messages,
  prereqs,
  type RestartedRun,
  results,
  type SentMessage,
  type StartedRun,
  sleep,
  waitFor,
} from "./harness.ts";

const state = prereqs();
const TASK_READ = "read README.md and answer with its first heading";

function lineCount(file: string): number {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

describe.skipIf(!state.ok)(`herdr e2e${state.ok ? "" : ` (skipped: ${state.reason})`}`, () => {
  let e2e: HerdrE2e;
  let parent4: { sessionFile: string; paneId: string };
  let parent5: { sessionFile: string; paneId: string };

  beforeAll(async () => {
    e2e = await HerdrE2e.create();
    e2e.writeProfile(
      "explore",
      "description: Explore the repo",
      "Read files and answer questions about the repository.",
    );
    e2e.writeProfile("selfexit", "description: Exit when done\nauto-exit: true", "Answer briefly, then stop.");
  }, 240_000);

  afterAll(async () => {
    await e2e?.teardown();
  });

  it("run delivers a done result and keeps the tab", async () => {
    const { sessionFile: parent } = await e2e.startParent("parent1");
    await e2e.prompt(
      "parent1",
      `Call subagent exactly once with action run, profile explore, task: ${TASK_READ}. Do not call it again. Do not wait for the result; end your turn after the tool returns.`,
    );

    const started = await waitFor(() => results<StartedRun>(parent, "running")[0], "running result");
    expect(started.name).toBe("explore-1");
    expect(dirname(started.sessionFile)).toBe(join(e2e.agentDir, "pi-herdr-subagents-lite", "sessions"));

    const done = await waitFor(() => messages(parent, "subagent_result")[0], "done result");
    expect(done).toContain(`[subagent ${started.name}] done`);
    expect(done).toContain("E2E Project");

    expect(await e2e.tabFor(started.name)).toBeDefined();
    const agents = await e2e.agents();
    expect(["idle", "done"]).toContain(agents.find((agent) => agent.name === started.name)?.agent_status);
    await e2e.closeChildren();
  }, 240_000);

  it("auto-exit closes the tab after the result", async () => {
    const { sessionFile: parent } = await e2e.startParent("parent2");
    await e2e.prompt(
      "parent2",
      `Call subagent exactly once with action run, profile selfexit, task: ${TASK_READ}. Do not call it again. Do not wait for the result; end your turn after the tool returns.`,
    );

    const started = await waitFor(() => results<StartedRun>(parent, "running")[0], "running result");
    const done = await waitFor(() => messages(parent, "subagent_result")[0], "done result");
    expect(done).toContain(`[subagent ${started.name}] done`);

    await waitFor(async () => (await e2e.tabFor(started.name)) === undefined, "tab to close", 60_000);
    const agents = await e2e.agents();
    expect(agents.find((agent) => agent.name === started.name)).toBeUndefined();
  }, 240_000);

  it("rejects a run above maxConcurrent", async () => {
    e2e.writeConfig({ maxConcurrent: 2, inboxPollMs: 100, pollIntervalMs: 200 });
    const { sessionFile: parent } = await e2e.startParent("parent3");
    await e2e.prompt(
      "parent3",
      [
        "Call the subagent tool exactly three times in this turn, all with action run and profile explore.",
        "Task 1: run the bash command 'sleep 30' then answer exactly ONE.",
        "Task 2: run the bash command 'sleep 30' then answer exactly TWO.",
        "Task 3: run the bash command 'sleep 30' then answer exactly THREE.",
        "Do not wait for results between calls. End your turn after the third call.",
      ].join("\n"),
    );

    await waitFor(() => errors(parent, "max_concurrent")[0], "max_concurrent error");
    expect(results<StartedRun>(parent, "running")).toHaveLength(2);
    const children = (await e2e.tabs()).filter((tab) => /^explore-\d+$/.test(tab.label));
    expect(children).toHaveLength(2);
    await e2e.closeChildren();
    e2e.writeConfig({ maxConcurrent: 16, inboxPollMs: 100, pollIntervalMs: 200 });
  }, 240_000);

  it("reports a killed child as pane_exited", async () => {
    parent4 = await e2e.startParent("parent4");
    const parent = parent4.sessionFile;
    await e2e.prompt(
      "parent4",
      "Call subagent exactly once with action run, profile explore, task: run the bash command 'sleep 60' then answer exactly KILL. Do not wait for the result.",
    );

    const started = await waitFor(() => results<StartedRun>(parent, "running")[0], "running result");
    await waitFor(
      () => readFileSync(started.sessionFile, "utf8").includes('"type":"toolCall"'),
      "child to start working",
    );
    const tab = await waitFor(() => e2e.tabFor(started.name), "worker tab");
    const pane = (await e2e.panes()).find((entry) => entry.tab_id === tab.tab_id);
    expect(pane).toBeDefined();

    killProcess(await e2e.childPid((pane as { pane_id: string }).pane_id));

    const unknown = await waitFor(() => messages(parent, "subagent_result")[0], "unknown result", 60_000);
    expect(unknown).toContain(`[subagent ${started.name}] unknown (pane_exited)`);
    expect(unknown).toContain(`Session: ${started.sessionFile}`);
    expect(await e2e.tabFor(started.name)).toBeDefined();
    await e2e.closeChildren();
  }, 240_000);

  it("does not reclaim children after /new", async () => {
    await waitFor(
      async () =>
        ["idle", "done"].includes((await e2e.agents()).find((agent) => agent.name === "parent4")?.agent_status ?? ""),
      "parent4 idle",
    );
    const before = new Set(readdirSync(join(e2e.agentDir, "sessions")));
    await e2e.type(parent4.paneId, "/new");
    await sleep(2000);
    await e2e.prompt("parent4", "Reply with exactly READY-NEW and call no tools.");

    const fresh = await waitFor(
      () => {
        for (const file of readdirSync(join(e2e.agentDir, "sessions"))) {
          if (!file.endsWith(".jsonl") || before.has(file)) {
            continue;
          }
          const path = join(e2e.agentDir, "sessions", file);
          if (readFileSync(path, "utf8").includes("READY-NEW")) {
            return path;
          }
        }
        return undefined;
      },
      "READY-NEW in a new session",
      90_000,
    );

    expect(messages(fresh, "subagent_result")).toHaveLength(0);
  }, 240_000);

  it("sends into a live child and keeps a split tab open", async () => {
    parent5 = await e2e.startParent("parent5");
    const parent = parent5.sessionFile;
    await e2e.prompt(
      "parent5",
      "Call subagent exactly once with action run, profile explore, task: run the bash command 'sleep 30' then answer exactly FIRST. Do not wait for the result; end your turn immediately after the tool returns.",
    );

    const started = await waitFor(() => results<StartedRun>(parent, "running")[0], "running result");
    const tab = await waitFor(() => e2e.tabFor(started.name), "worker tab");
    const pane = (await e2e.panes()).find((entry) => entry.tab_id === tab.tab_id);
    await e2e.call([
      "pane",
      "split",
      "--pane",
      (pane as { pane_id: string }).pane_id,
      "--direction",
      "right",
      "--no-focus",
    ]);

    const first = await waitFor(() => messages(parent, "subagent_result")[0], "first result");
    expect(first).toContain("FIRST");
    const kept = await waitFor(() => e2e.tabFor(started.name), "tab still open");
    expect(kept.pane_count).toBe(2);

    const lines = lineCount(started.sessionFile);
    await e2e.prompt(
      "parent5",
      `Call the subagent tool exactly once with action send, name ${started.name}, and message exactly: Answer exactly SECOND and call no tools. Do not call run. End your turn after the tool returns.`,
    );
    await waitFor(() => results<SentMessage>(parent, "sent")[0], "sent result");
    const second = await waitFor(() => messages(parent, "subagent_result")[1], "second result");
    expect(second).toContain("SECOND");
    expect(lineCount(started.sessionFile)).toBeGreaterThan(lines);
    expect((await e2e.tabFor(started.name))?.pane_count).toBe(2);
  }, 240_000);

  it("restarts an exited child in a new pane", async () => {
    const parent = parent5.sessionFile;
    const name = (await waitFor(() => results<SentMessage>(parent, "sent")[0], "sent result")).name;
    const tab = await waitFor(() => e2e.tabFor(name), "worker tab");
    const before = (await e2e.panes()).find((entry) => entry.tab_id === tab.tab_id);

    await e2e.call(["tab", "close", tab.tab_id]);
    await waitFor(
      async () => (await e2e.agents()).every((agent) => agent.pane_id !== (before as { pane_id: string }).pane_id),
      "child pane to disappear",
    );

    await e2e.prompt(
      "parent5",
      `Call the subagent tool exactly once with action send, name ${name}, and message exactly: run the bash command 'sleep 20' then answer exactly THIRD. Do not call run. End your turn after the tool returns.`,
    );
    const restarted = await waitFor(() => results<RestartedRun>(parent, "restarted")[0], "restarted result");
    expect(restarted.name).toBe(name);
    expect(restarted.paneId).not.toBe((before as { pane_id: string }).pane_id);

    const third = await waitFor(() => messages(parent, "subagent_result")[2], "third result", 120_000);
    expect(third).toContain("THIRD");
    await e2e.closeChildren();
  }, 240_000);
});
