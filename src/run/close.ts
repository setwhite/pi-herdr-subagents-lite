import type { RunResult } from "./result.ts";
import type { RunRecord, RunState } from "./state.ts";

export function shouldClose(run: RunRecord, result: RunResult): boolean {
  return result.state === "done" && run.autoExit;
}

export async function closeTab(state: RunState, run: RunRecord): Promise<void> {
  await state.host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
}

export interface CloseChildrenResult {
  kept: string[];
  failed: Array<{ name: string; reason: string }>;
}

export async function closeRuns(state: RunState, runs: RunRecord[]): Promise<CloseChildrenResult> {
  const kept: string[] = [];
  const failed: CloseChildrenResult["failed"] = [];
  for (const run of runs) {
    if (!run.tabId) {
      continue;
    }
    try {
      const outcome = await state.host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
      if (outcome === "kept") {
        kept.push(run.name);
      }
    } catch (error) {
      failed.push({ name: run.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { kept, failed };
}
