import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HerdrHost, HerdrHostError } from "../herdr/index.ts";

const MAX_CONCURRENT = 4;
const NAME_RETRIES = 3;

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
  active(): string[];
}

export interface SubagentServiceDeps {
  host: HerdrHost;
}

interface ActiveRun {
  name: string;
  paneId: string;
  sessionFile: string;
  tabId: string;
}

function spawnFailed(error: unknown, paneId: string | undefined): ToolError {
  const detail = error instanceof Error ? error.message : String(error);
  const created = paneId ? `; pane ${paneId} was created` : "";
  return new ToolError("spawn_failed", `${detail}${created}`);
}

export function createSubagentService({ host }: SubagentServiceDeps): SubagentService {
  const runs: ActiveRun[] = [];
  const runRoot = join(tmpdir(), "pi-herdr-subagents-lite", `${Date.now()}-${randomUUID()}`);
  let nextWorkerNumber = 1;
  let nextRunNumber = 1;

  const nextName = () => `worker-${nextWorkerNumber++}`;
  const active = () => runs.map((run) => run.name);

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

        return {
          state: "running",
          name: run.name,
          paneId: run.paneId,
          sessionFile: run.sessionFile,
        };
      } catch (error) {
        const index = runs.indexOf(run);
        if (index >= 0) {
          runs.splice(index, 1);
        }
        throw error instanceof ToolError ? error : spawnFailed(error, run.paneId || undefined);
      }
    },

    active,
  };
}
