import type { AgentEntry, AgentSnapshot, ResumeAgentInput, StartAgentInput } from "./agent.ts";
import { createAgentCommands } from "./agent.ts";
import { execHerdrJson, HerdrHostError } from "./cli.ts";
import type { CloseTabInput, CreatedTab, CreateTabInput, RenamePaneInput, RenameTabInput } from "./pane.ts";
import { createPaneCommands } from "./pane.ts";

export { HerdrHostError };

export interface HerdrHost {
  createTab(input: CreateTabInput): Promise<CreatedTab>;
  renameTab(input: RenameTabInput): Promise<void>;
  renamePane(input: RenamePaneInput): Promise<void>;
  startAgent(input: StartAgentInput): Promise<void>;
  resumeAgent(input: ResumeAgentInput): Promise<void>;
  hasPane(paneId: string): Promise<boolean>;
  listAgents(): Promise<AgentEntry[]>;
  closeTabIfOnlyPane(input: CloseTabInput): Promise<"closed" | "kept">;
}

export type { AgentEntry, AgentSnapshot, ResumeAgentInput, StartAgentInput };

export function createHerdrHost(): HerdrHost {
  return { ...createPaneCommands(execHerdrJson), ...createAgentCommands(execHerdrJson) };
}
