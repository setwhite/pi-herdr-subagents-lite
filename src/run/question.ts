import type { AgentEntry } from "../herdr/index.ts";
import type { RunRecord, RunState } from "./state.ts";

const PANE_LINES = 40;

export interface RunQuestion {
  name: string;
  text: string;
}

export type QuestionHandler = (question: RunQuestion) => void | Promise<void>;

export async function askBlocked(state: RunState, run: RunRecord, agent: AgentEntry): Promise<boolean> {
  if (run.blocked) {
    return true;
  }
  try {
    const text = await state.host.readAgent(agent.name ?? run.name, PANE_LINES);
    run.blocked = true;
    await state.questionHandler?.({ name: run.name, text });
    run.pollFailures = 0;
    return true;
  } catch {
    run.pollFailures += 1;
    return false;
  }
}
