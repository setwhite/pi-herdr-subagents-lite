import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { HerdrHostError } from "../herdr/index.ts";
import { createInbox, removeInbox } from "../inbox/index.ts";
import { spawnFailed, ToolError } from "./errors.ts";
import { paneLabel } from "./naming.ts";
import { ensurePoll } from "./poll.ts";
import { resolveProfile } from "./resolve.ts";
import { AUTO_EXIT_ENV, agentArgs, briefText, parentCwd, resolveCwd } from "./spawn-args.ts";
import type { RunRecord, RunState } from "./state.ts";

const NAME_ATTEMPTS = 100;

export interface RunStarted {
  state: "running";
  name: string;
  paneId: string;
  sessionFile: string;
}

function samePath(left: string, right: string): boolean {
  return relative(left, right) === "";
}

export async function createPane(state: RunState, run: RunRecord, cwd: string, label: string): Promise<void> {
  const workspaceId = samePath(cwd, parentCwd())
    ? undefined
    : (await state.host.createWorkspace({ cwd, label: run.name })).workspaceId;
  const tab = await state.host.createTab({
    cwd,
    label: run.name,
    workspaceId,
    env: { [AUTO_EXIT_ENV]: run.autoExit ? "1" : "0" },
  });
  run.tabId = tab.tabId;
  run.paneId = tab.paneId;
  await state.host.renamePane({ paneId: tab.paneId, label });
}

export async function start(state: RunState, profileName: string, task: string, rawCwd?: string): Promise<RunStarted> {
  const profile = resolveProfile(state.loadProfiles(), profileName);
  if (state.active().length >= state.maxConcurrent) {
    const names = state.active().join(", ");
    throw new ToolError("max_concurrent", `at max concurrency; running: ${names}`);
  }

  const runId = randomUUID();
  const files = (name: string) => {
    const sessionFile = join(state.sessionsDir, `${name}-${runId}.jsonl`);
    return {
      sessionFile,
      briefFile: `${sessionFile}.brief.md`,
      identityFile: `${sessionFile}.identity.md`,
    };
  };
  const name = state.nextName(profileName);
  let current = files(name);
  const cwd = resolveCwd(rawCwd);
  const run: RunRecord = {
    name,
    profileName: profile.name,
    paneId: "",
    paneLabel: "",
    sessionFile: current.sessionFile,
    cwd,
    tabId: "",
    autoExit: profile.autoExit,
    lastHandledSeq: 0,
    lastDeliveredText: null,
    artifactSeq: 0,
    pollFailures: 0,
    live: true,
  };
  // 先占槽再 await：并发的 run() 必须立刻看到它。
  state.runs.push(run);

  try {
    run.paneLabel = paneLabel(task) || run.name;
    await createPane(state, run, cwd, run.paneLabel);
    await mkdir(state.sessionsDir, { recursive: true });

    for (let retry = 1; ; retry++) {
      await writeFile(current.briefFile, briefText(profile, task), "utf8");
      if (profile.systemPrompt !== "task") {
        await writeFile(current.identityFile, profile.body, "utf8");
      }
      await createInbox(current.sessionFile);
      try {
        await state.host.startAgent({
          name: run.name,
          paneId: run.paneId,
          sessionFile: current.sessionFile,
          briefFile: current.briefFile,
          agentArgs: agentArgs(profile, current.identityFile, state.toolName),
        });
        break;
      } catch (error) {
        if (!(error instanceof HerdrHostError && error.code === "name_taken")) {
          throw error;
        }
        await Promise.all([
          rm(current.briefFile, { force: true }),
          rm(current.identityFile, { force: true }),
          removeInbox(current.sessionFile),
        ]);
        if (retry >= NAME_ATTEMPTS) {
          throw new ToolError(
            "name_exhausted",
            `no free name for profile "${profileName}" after ${NAME_ATTEMPTS} attempts`,
          );
        }
        run.name = state.nextName(profileName);
        await state.host.renameTab({ tabId: run.tabId, label: run.name });
        current = files(run.name);
        run.sessionFile = current.sessionFile;
      }
    }

    ensurePoll(state);

    return {
      state: "running",
      name: run.name,
      paneId: run.paneId,
      sessionFile: run.sessionFile,
    };
  } catch (error) {
    state.release(run);
    if (error instanceof ToolError) {
      throw error;
    }
    throw spawnFailed(error, run.paneId || undefined);
  }
}
