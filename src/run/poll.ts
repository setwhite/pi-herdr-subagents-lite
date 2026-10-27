import type { AgentSnapshot } from "../herdr/index.ts";
import type { RunResult, UnknownReason, UnknownResult } from "./result.ts";
import { resultText } from "./result.ts";
import type { RunRecord, RunState } from "./state.ts";

const POLL_INTERVAL_MS = 1000;
const POLL_FAILURE_LIMIT = 3;
const READ_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 200;

export function schedulePoll(state: RunState, run: RunRecord): void {
  state.schedule(run, POLL_INTERVAL_MS, () => void poll(state, run));
}

async function poll(state: RunState, run: RunRecord) {
  run.timer = undefined;
  if (!run.live) {
    return;
  }

  let snapshot: AgentSnapshot | null;
  try {
    snapshot = await state.host.getAgent(run.name);
  } catch {
    if (!run.live) {
      return;
    }
    run.pollFailures += 1;
    if (run.pollFailures >= POLL_FAILURE_LIMIT) {
      await finish(state, run, unknownResult(run, "poll_failed"));
      return;
    }
    schedulePoll(state, run);
    return;
  }
  if (!run.live) {
    return;
  }
  run.pollFailures = 0;

  if (!snapshot) {
    await finish(state, run, unknownResult(run, "agent_missing"));
    return;
  }

  if (snapshot.completionSeq > run.lastHandledSeq && (snapshot.status === "idle" || snapshot.status === "done")) {
    await readResult(state, run, snapshot.completionSeq, 1);
    return;
  }

  schedulePoll(state, run);
}

async function readResult(state: RunState, run: RunRecord, seq: number, attempt: number) {
  run.timer = undefined;
  if (!run.live) {
    return;
  }

  const snapshot = state.readLastAssistant(run.sessionFile);
  if (snapshot.pendingToolCall) {
    schedulePoll(state, run);
    return;
  }
  if (snapshot.text !== null) {
    run.lastHandledSeq = seq;
    await finish(state, run, {
      state: "done",
      name: run.name,
      text: resultText(snapshot.text, state.maxResultChars, run.sessionFile),
      sessionFile: run.sessionFile,
      paneId: run.paneId,
    });
    return;
  }

  if (attempt >= READ_ATTEMPTS) {
    run.lastHandledSeq = seq;
    await finish(state, run, unknownResult(run, "no_result"));
    return;
  }

  state.schedule(run, READ_RETRY_DELAY_MS, () => void readResult(state, run, seq, attempt + 1));
}

function unknownResult(run: RunRecord, reason: UnknownReason): UnknownResult {
  return {
    state: "unknown",
    name: run.name,
    reason,
    sessionFile: run.sessionFile,
    paneId: run.paneId,
  };
}

async function finish(state: RunState, run: RunRecord, result: RunResult): Promise<void> {
  try {
    await state.resultHandler?.(result);
    if (result.state === "done") {
      try {
        await state.host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
      } catch {
        // The result is delivered; a failed close leaves the tab for a human.
      }
    }
  } finally {
    state.settle(run);
  }
}
