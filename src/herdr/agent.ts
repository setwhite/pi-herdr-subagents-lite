import { type ExecHerdr, HerdrHostError } from "./cli.ts";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentSnapshot {
  status: AgentStatus;
  completionSeq: number;
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

export function createAgentCommands(exec: ExecHerdr) {
  return {
    async startAgent({ name, briefFile, ...input }: StartAgentInput) {
      await exec(agentStartCommand({ name, ...input }));
      await exec(["agent", "prompt", name, `@${briefFile}`]);
    },

    async resumeAgent(input: ResumeAgentInput) {
      await exec(agentStartCommand(input));
    },

    async getAgent(name: string): Promise<AgentSnapshot | null> {
      try {
        const result = await exec<{ agent: AgentInfo }>(["agent", "get", name]);
        return {
          status: result.agent.agent_status,
          completionSeq: result.agent.completion_seq ?? 0,
        };
      } catch (error) {
        if (error instanceof HerdrHostError && error.code === "agent_not_found") {
          return null;
        }
        throw error;
      }
    },
  };
}
