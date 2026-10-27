import type { AgentEntry } from "../herdr/index.ts";
import type { RunRecord } from "./state.ts";

export function findAgent(agents: AgentEntry[], run: RunRecord): AgentEntry | undefined {
  return agents.find((entry) => entry.paneId === run.paneId) ?? agents.find((entry) => entry.name === run.name);
}
