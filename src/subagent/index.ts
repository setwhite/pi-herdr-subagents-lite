import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSnapshot, type HerdrHost, HerdrHostError } from "../herdr/index.ts";
import type { SessionReader } from "../session/index.ts";

const MAX_CONCURRENT = 4;
const NAME_RETRIES = 3;
const POLL_INTERVAL_MS = 1000;

const WORKER_INSTRUCTIONS = `You are a worker subagent. Complete the task below in the current working directory.
Do not spawn subagents. If you need a decision and ask_user_question is available,
use it; the human answers in your pane. Otherwise, state the decision needed in your
final answer. Finish with a concise summary: what you did, where, and any open questions.`;

export interface RunStarted {
  state: "running";
  name: string;
  paneId: string;
  sessionFile: string;
}

export interface DoneResult {
  state: "done";
  name: string;
  text: string;
  sessionFile: string;
  paneId: string;
}

export interface UnknownResult {
  state: "unknown";
  name: string;
  reason: string;
  sessionFile: string;
  paneId: string;
}

export type SubagentResult = DoneResult | UnknownResult;

export type ResultHandler = (result: SubagentResult) => void | Promise<void>;

export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export interface SubagentService {
  run(task: string): Promise<RunStarted>;
  onResult(handler: ResultHandler): void;
  shutdown(): void;
  active(): string[];
}

export interface SubagentServiceDeps {
  host: HerdrHost;
  readLastAssistantText: SessionReader;
}

interface ActiveRun {
  name: string;
  paneId: string;
  sessionFile: string;
  tabId: string;
  pollTimer?: ReturnType<typeof setTimeout>;
  finished: boolean;
}

function spawnFailed(error: unknown, paneId: string | undefined): ToolError {
  const detail = error instanceof Error ? error.message : String(error);
  const created = paneId ? `; pane ${paneId} was created` : "";
  const trust =
    error instanceof HerdrHostError && error.code === "agent_not_ready"
      ? " and is likely waiting at a trust dialog; answer it in that pane, then run again"
      : "";
  return new ToolError("spawn_failed", `${detail}${created}${trust}`);
}

export function createSubagentService({ host, readLastAssistantText }: SubagentServiceDeps): SubagentService {
  const runs: ActiveRun[] = [];
  const runRoot = join(tmpdir(), "pi-herdr-subagents-lite", `${Date.now()}-${randomUUID()}`);
  let nextWorkerNumber = 1;
  let nextRunNumber = 1;
  let resultHandler: ResultHandler | undefined;

  const nextName = () => `worker-${nextWorkerNumber++}`;
  const active = () => runs.map((run) => run.name);

  function clearPoll(run: ActiveRun) {
    if (run.pollTimer !== undefined) {
      clearTimeout(run.pollTimer);
      run.pollTimer = undefined;
    }
  }

  function release(run: ActiveRun) {
    run.finished = true;
    clearPoll(run);
    const index = runs.indexOf(run);
    if (index >= 0) {
      runs.splice(index, 1);
    }
  }

  function schedulePoll(run: ActiveRun) {
    if (run.finished) {
      return;
    }
    run.pollTimer = setTimeout(() => {
      void poll(run);
    }, POLL_INTERVAL_MS);
    run.pollTimer.unref?.();
  }

  async function poll(run: ActiveRun) {
    run.pollTimer = undefined;
    if (run.finished) {
      return;
    }

    let snapshot: AgentSnapshot | null;
    try {
      snapshot = await host.getAgent(run.name);
    } catch {
      schedulePoll(run);
      return;
    }
    if (run.finished) {
      return;
    }

    if (snapshot && snapshot.completionSeq > 0 && (snapshot.status === "idle" || snapshot.status === "done")) {
      await complete(run);
      return;
    }

    schedulePoll(run);
  }

  async function complete(run: ActiveRun) {
    try {
      const text = readLastAssistantText(run.sessionFile);
      if (text === null) {
        return;
      }
      await resultHandler?.({
        state: "done",
        name: run.name,
        text,
        sessionFile: run.sessionFile,
        paneId: run.paneId,
      });
      try {
        await host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
      } catch {
        // The result is delivered; a failed close leaves the tab for a human.
      }
    } finally {
      release(run);
    }
  }

  return {
    async run(task) {
      if (runs.length >= MAX_CONCURRENT) {
        const names = active().join(", ");
        throw new ToolError("max_concurrent", `already running ${names}; wait for a result or close one`);
      }

      const runNumber = nextRunNumber++;
      const run: ActiveRun = {
        name: nextName(),
        paneId: "",
        sessionFile: join(runRoot, `session-${runNumber}.jsonl`),
        tabId: "",
        finished: false,
      };
      runs.push(run);

      try {
        await mkdir(runRoot, { recursive: true });
        const briefFile = join(runRoot, `brief-${runNumber}.md`);
        await writeFile(briefFile, `${WORKER_INSTRUCTIONS}\n\n# Task\n${task}\n`, "utf8");

        const tab = await host.createTab({ cwd: process.cwd(), label: run.name });
        run.tabId = tab.tabId;
        run.paneId = tab.paneId;

        for (let retry = 0; ; retry++) {
          try {
            await host.startAgent({
              name: run.name,
              paneId: tab.paneId,
              sessionFile: run.sessionFile,
              briefFile,
            });
            break;
          } catch (error) {
            const nameTaken = error instanceof HerdrHostError && error.code === "name_taken";
            if (!nameTaken || retry >= NAME_RETRIES) {
              throw error;
            }
            run.name = nextName();
            await host.renameTab({ tabId: tab.tabId, label: run.name });
          }
        }

        schedulePoll(run);

        return {
          state: "running",
          name: run.name,
          paneId: run.paneId,
          sessionFile: run.sessionFile,
        };
      } catch (error) {
        release(run);
        throw spawnFailed(error, run.paneId || undefined);
      }
    },

    onResult(handler) {
      resultHandler = handler;
    },

    shutdown() {
      for (const run of runs) {
        run.finished = true;
        clearPoll(run);
      }
      runs.length = 0;
    },

    active,
  };
}
