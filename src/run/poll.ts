import type { AgentEntry } from "../herdr/index.ts";
import { closeTab, shouldClose } from "./close.ts";
import { findAgent } from "./find.ts";
import type { RunResult } from "./result.ts";
import { doneResult, unknownResult } from "./result.ts";
import type { RunRecord, RunState } from "./state.ts";

const POLL_FAILURE_LIMIT = 3;
const READ_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 200;

export function ensurePoll(state: RunState): void {
  if (state.pollTimer !== undefined || state.pollBusy) {
    return;
  }
  if (!state.runs.some((run) => run.live)) {
    return;
  }
  state.pollTimer = setTimeout(() => void tick(state), state.pollIntervalMs);
  state.pollTimer.unref?.();
}

export function stopPoll(state: RunState): void {
  if (state.pollTimer !== undefined) {
    clearTimeout(state.pollTimer);
    state.pollTimer = undefined;
  }
}

async function tick(state: RunState): Promise<void> {
  state.pollTimer = undefined;
  state.pollBusy = true;
  try {
    await pollRuns(state);
  } catch {
    // 同步投递失败时 finish 已结算该 run；其余 run 下一拍继续。
  } finally {
    state.pollBusy = false;
    ensurePoll(state);
  }
}

async function pollRuns(state: RunState): Promise<void> {
  let agents: AgentEntry[];
  try {
    agents = await state.host.listAgents();
  } catch {
    for (const run of [...state.runs]) {
      if (!run.live) {
        continue;
      }
      run.pollFailures += 1;
      if (run.pollFailures >= POLL_FAILURE_LIMIT) {
        await finish(state, run, unknownResult(run, "poll_failed"));
      }
    }
    return;
  }
  for (const run of [...state.runs]) {
    if (!run.live || run.timer !== undefined) {
      continue;
    }
    const agent = findAgent(agents, run);
    if (!agent) {
      await exited(state, run);
      continue;
    }
    run.pollFailures = 0;
    if (agent.completionSeq > run.lastHandledSeq && (agent.status === "idle" || agent.status === "done")) {
      await readResult(state, run, agent.completionSeq, 1);
    }
  }
}

async function readResult(state: RunState, run: RunRecord, seq: number, attempt: number) {
  run.timer = undefined;
  if (!run.live) {
    return;
  }

  const snapshot = state.readLastAssistant(run.sessionFile);
  if (snapshot.pendingToolCall || snapshot.empty) {
    ensurePoll(state);
    return;
  }
  if (snapshot.text !== null) {
    run.lastHandledSeq = seq;
    run.lastDeliveredText = snapshot.text;
    await finish(state, run, doneResult(run, snapshot.text, state.maxResultChars));
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
  if (!run.live) {
    return;
  }
  const tail = state.readLastAssistant(run.sessionFile);
  const text = tail.pendingToolCall ? null : tail.text;
  if (text !== null) {
    if (text !== run.lastDeliveredText) {
      run.lastDeliveredText = text;
      await finish(state, run, doneResult(run, text, state.maxResultChars));
    }
  } else if (run.lastDeliveredText === null) {
    const reason = state.readExitReceipt(run.sessionFile) ? "quitted" : "pane_exited";
    await finish(state, run, unknownResult(run, reason));
  }
  state.settle(run);
}

async function finish(state: RunState, run: RunRecord, result: RunResult): Promise<void> {
  try {
    await state.results?.push(result);
  } catch (error) {
    state.settle(run);
    throw error;
  }
  if (shouldClose(run, result)) {
    try {
      await closeTab(state, run);
    } catch {
      await state.results?.push(unknownResult(run, "close_failed"));
    }
    state.settle(run);
    return;
  }
  if (result.state !== "done") {
    state.settle(run);
  }
}
