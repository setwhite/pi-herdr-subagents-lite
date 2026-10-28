import type { ExecHerdr, ExecHerdrText } from "./cli.ts";

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
  briefFile: string;
}

export type ResumeAgentInput = Omit<StartAgentInput, "briefFile">;

interface AgentInfo {
  agent_status: AgentStatus;
  completion_seq?: number | null;
  state_change_seq?: number;
  name?: string | null;
  pane_id: string;
}

function agentStartCommand(input: ResumeAgentInput): string[] {
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

export function createAgentCommands(exec: ExecHerdr, execText: ExecHerdrText) {
  return {
    async startAgent({ name, briefFile, ...input }: StartAgentInput) {
      await exec(agentStartCommand({ name, ...input }));
      await exec(["agent", "prompt", name, `@${briefFile}`]);
    },

    async resumeAgent(input: ResumeAgentInput) {
      await exec(agentStartCommand(input));
    },

    async readAgent(name: string, lines: number): Promise<string> {
      return execText(["agent", "read", name, "--lines", String(lines), "--format", "text"]);
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
