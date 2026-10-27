import type { RunResult } from "./result.ts";
import type { RunRecord, RunState } from "./state.ts";

export function shouldClose(run: RunRecord, result: RunResult): boolean {
  return result.state === "done" && run.autoExit;
}

export async function closeTab(state: RunState, run: RunRecord): Promise<void> {
  await state.host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
}
