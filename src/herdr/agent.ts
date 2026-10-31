import type { ExecHerdr } from "./cli.ts";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSnapshot {
  status: AgentStatus;
  completionSeq: number;
}

export interface AgentEntry extends AgentSnapshot {
  name: string | null;
  paneId: string;
}

export interface StartAgentInput {
  name: string;
  paneId: string;
  sessionFile: string;
  agentArgs: string[];
}

interface AgentInfo {
  agent_status: AgentStatus;
  completion_seq?: number | null;
  state_change_seq?: number;
  name?: string | null;
  pane_id: string;
}

function agentStartCommand(input: StartAgentInput): string[] {
  return [
    "agent",
    "start",
    input.name,
    "--kind",
    "pi",
    "--pane",
    input.paneId,
    "--timeout",
    "30000",
    "--",
    "--session",
    input.sessionFile,
    ...input.agentArgs,
  ];
}

export function createAgentCommands(exec: ExecHerdr) {
  return {
    async startAgent(input: StartAgentInput) {
      await exec(agentStartCommand(input));
    },

    async listAgents(): Promise<AgentEntry[]> {
      const result = await exec<{ agents: AgentInfo[] }>(["agent", "list"]);
      return result.agents.map((agent) => ({
        name: agent.name ?? null,
        paneId: agent.pane_id,
        status: agent.agent_status,
        completionSeq: agent.completion_seq ?? agent.state_change_seq ?? 0,
      }));
    },
  };
}
