import type { AgentEntry } from "../herdr/index.ts";
import { findAgent } from "./find.ts";
import { exited, readResult, recordFailure } from "./poll-result.ts";
import type { RunRecord, RunState } from "./state.ts";

const ACTIVITY_WINDOW_MS = 30_000;
const BUSY_STATUSES = new Set(["working", "blocked", "unknown"]);

// 不排 0 延迟：启动瞬间 agent 可能还没进 agent list，会被误判成 pane 已退出。
export function wake(state: RunState): void {
  state.activeUntil = state.now() + ACTIVITY_WINDOW_MS;
  reschedule(state, state.pollIntervalMs);
}

export function stopPoll(state: RunState): void {
  if (state.pollTimer !== undefined) {
    clearTimeout(state.pollTimer);
    state.pollTimer = undefined;
  }
}

function reschedule(state: RunState, delayMs: number): void {
  stopPoll(state);
  if (state.stopped) {
    return;
  }
  state.pollTimer = setTimeout(() => void tick(state), delayMs);
  state.pollTimer.unref?.();
}

function plan(state: RunState, agents: AgentEntry[]): number | undefined {
  const live = state.runs.filter((run) => run.live);
  if (live.length === 0) {
    return undefined;
  }
  const now = state.now();
  let soonest: number | undefined;
  for (const run of live) {
    if (run.read === undefined) {
      continue;
    }
    const delay = Math.max(0, run.read.at - now);
    soonest = soonest === undefined ? delay : Math.min(soonest, delay);
  }
  if (soonest !== undefined) {
    return soonest;
  }
  const busy =
    now < state.activeUntil || live.some((run) => BUSY_STATUSES.has(findAgent(agents, run)?.status ?? "unknown"));
  return busy ? state.pollIntervalMs : state.idlePollIntervalMs;
}

async function tick(state: RunState): Promise<void> {
  state.pollTimer = undefined;
  state.pollBusy = true;
  let agents: AgentEntry[] = [];
  try {
    agents = await pollRuns(state);
  } catch {
    // 单个 run 的投递失败不会中断其余 run；下一拍继续。
  } finally {
    state.pollBusy = false;
    const delay = plan(state, agents);
    if (delay !== undefined) {
      reschedule(state, delay);
    }
  }
}

async function pollRun(state: RunState, agents: AgentEntry[], run: RunRecord): Promise<void> {
  const agent = findAgent(agents, run);
  if (!agent) {
    await exited(state, run);
    return;
  }
  run.pollFailures = 0;
  if (run.read !== undefined) {
    if (state.now() < run.read.at) {
      return;
    }
    await readResult(state, run, Math.max(run.read.seq, agent.completionSeq), run.read.attempt + 1);
    return;
  }
  if (agent.completionSeq > run.lastHandledSeq && (agent.status === "idle" || agent.status === "done")) {
    await readResult(state, run, agent.completionSeq, 1);
  }
}

async function pollRuns(state: RunState): Promise<AgentEntry[]> {
  let agents: AgentEntry[];
  try {
    agents = await state.host.listAgents();
  } catch {
    for (const run of [...state.runs]) {
      await recordFailure(state, run);
    }
    return [];
  }
  for (const run of [...state.runs]) {
    if (!run.live) {
      continue;
    }
    try {
      await pollRun(state, agents, run);
    } catch {
      await recordFailure(state, run);
    }
  }
  return agents;
}
