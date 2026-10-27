import type { AgentSnapshot } from "../herdr/index.ts";
import { closeTab, shouldClose } from "./close.ts";
import type { DoneResult, RunResult, UnknownReason, UnknownResult } from "./result.ts";
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
    await exited(state, run);
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
    run.lastDeliveredText = snapshot.text;
    await finish(state, run, doneResult(state, run, snapshot.text));
    return;
  }

  if (attempt >= READ_ATTEMPTS) {
    run.lastHandledSeq = seq;
    await finish(state, run, unknownResult(run, "no_result"));
    return;
  }

  state.schedule(run, READ_RETRY_DELAY_MS, () => void readResult(state, run, seq, attempt + 1));
}

async function exited(state: RunState, run: RunRecord): Promise<void> {
  const tail = state.readLastAssistant(run.sessionFile);
  const text = tail.pendingToolCall ? null : tail.text;
  if (text !== null) {
    if (text !== run.lastDeliveredText) {
      run.lastDeliveredText = text;
      await finish(state, run, doneResult(state, run, text));
    }
  } else if (run.lastDeliveredText === null) {
    const reason = state.readExitReceipt(run.sessionFile) ? "quitted" : "pane_exited";
    await finish(state, run, unknownResult(run, reason));
  }
  state.settle(run);
}

function doneResult(state: RunState, run: RunRecord, text: string): DoneResult {
  return {
    state: "done",
    name: run.name,
    text: resultText(text, state.maxResultChars, run.sessionFile),
    sessionFile: run.sessionFile,
    paneId: run.paneId,
  };
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
  } catch (error) {
    state.settle(run);
    throw error;
  }
  if (shouldClose(run, result)) {
    try {
      await closeTab(state, run);
    } catch {
      await state.resultHandler?.(unknownResult(run, "close_failed"));
    }
    state.settle(run);
    return;
  }
  if (result.state === "done") {
    schedulePoll(state, run);
    return;
  }
  state.settle(run);
}
