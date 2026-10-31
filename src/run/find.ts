import type { AgentEntry } from "../herdr/index.ts";
import type { RunRecord } from "./state.ts";

export function findAgent(agents: AgentEntry[], run: RunRecord): AgentEntry | undefined {
  const paneId = run.pane?.paneId;
  const byPane = paneId === undefined ? undefined : agents.find((entry) => entry.paneId === paneId);
  return byPane ?? agents.find((entry) => entry.name === run.name);
}
