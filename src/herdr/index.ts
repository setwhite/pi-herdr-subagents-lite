import type { AgentEntry, AgentSnapshot, ResumeAgentInput, StartAgentInput } from "./agent.ts";
import { createAgentCommands } from "./agent.ts";
import { execHerdrJson, execHerdrText, HerdrHostError } from "./cli.ts";
import type {
  CloseTabInput,
  CloseTabResult,
  CreatedTab,
  CreateTabInput,
  RenamePaneInput,
  RenameTabInput,
} from "./pane.ts";
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
  readAgent(name: string, lines: number): Promise<string>;
  closeTabIfOnlyPane(input: CloseTabInput): Promise<CloseTabResult>;
}

export type { AgentEntry, AgentSnapshot, CloseTabResult, ResumeAgentInput, StartAgentInput };

export function createHerdrHost(): HerdrHost {
  return { ...createPaneCommands(execHerdrJson), ...createAgentCommands(execHerdrJson, execHerdrText) };
}
