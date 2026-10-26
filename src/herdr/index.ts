import { execFile } from "node:child_process";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface CreatedTab {
  tabId: string;
  paneId: string;
}

export interface StartAgentInput {
  name: string;
  paneId: string;
  sessionFile: string;
  briefFile: string;
  agentArgs: string[];
}

export interface AgentSnapshot {
  status: AgentStatus;
  completionSeq: number;
}

export interface CloseTabInput {
  tabId: string;
  paneId: string;
}

export interface RenameTabInput {
  tabId: string;
  label: string;
}

export interface HerdrHost {
  createTab(input: { cwd: string; label: string }): Promise<CreatedTab>;
  renameTab(input: RenameTabInput): Promise<void>;
  startAgent(input: StartAgentInput): Promise<void>;
  getAgent(name: string): Promise<AgentSnapshot | null>;
  closeTabIfOnlyPane(input: CloseTabInput): Promise<"closed" | "kept">;
}

export class HerdrHostError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HerdrHostError";
    this.code = code;
  }
}

interface HerdrErrorBody {
  code?: string;
  message?: string;
}

interface AgentInfo {
  agent_status: AgentStatus;
  completion_seq?: number | null;
}

interface TabInfo {
  tab_id: string;
  workspace_id: string;
  pane_count: number;
}

interface PaneInfo {
  pane_id: string;
  tab_id: string;
}

const HOST_ERROR_CODES: Record<string, string> = {
  agent_name_taken: "name_taken",
};

function hostError(code: string, message: string): HerdrHostError {
  return new HerdrHostError(HOST_ERROR_CODES[code] ?? code, message);
}

function parseHerdrError(text: string): HerdrErrorBody | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { error?: HerdrErrorBody };
    return parsed.error?.code ? parsed.error : null;
  } catch {
    return null;
  }
}

function runHerdr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "herdr",
      args,
      { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const parsed = parseHerdrError(stderr) ?? parseHerdrError(stdout);
        reject(
          parsed
            ? hostError(parsed.code ?? "herdr_failed", parsed.message ?? parsed.code ?? "herdr failed")
            : new HerdrHostError("herdr_failed", error.message),
        );
      },
    );
  });
}

async function execHerdrJson<T>(args: string[]): Promise<T> {
  const stdout = await runHerdr(args);
  let parsed: { result?: T; error?: HerdrErrorBody };
  try {
    parsed = JSON.parse(stdout) as { result?: T; error?: HerdrErrorBody };
  } catch {
    throw new HerdrHostError("herdr_protocol", `herdr ${args.join(" ")} returned invalid JSON`);
  }
  if (parsed.error?.code) {
    throw hostError(parsed.error.code, parsed.error.message ?? parsed.error.code);
  }
  if (parsed.result === undefined) {
    throw new HerdrHostError("herdr_protocol", `herdr ${args.join(" ")} returned no result`);
  }
  return parsed.result;
}

export function createHerdrHost(): HerdrHost {
  return {
    async createTab({ cwd, label }) {
      const result = await execHerdrJson<{ tab: TabInfo; root_pane: PaneInfo }>([
        "tab",
        "create",
        "--cwd",
        cwd,
        "--label",
        label,
        "--no-focus",
      ]);
      return { tabId: result.tab.tab_id, paneId: result.root_pane.pane_id };
    },

    async renameTab({ tabId, label }) {
      await execHerdrJson(["tab", "rename", tabId, label]);
    },

    async startAgent({ name, paneId, sessionFile, briefFile, agentArgs }) {
      await execHerdrJson([
        "agent",
        "start",
        name,
        "--kind",
        "pi",
        "--pane",
        paneId,
        "--timeout",
        "30000",
        "--",
        "--session",
        sessionFile,
        ...agentArgs,
      ]);
      await execHerdrJson(["agent", "prompt", name, `@${briefFile}`]);
    },

    async getAgent(name) {
      try {
        const result = await execHerdrJson<{ agent: AgentInfo }>(["agent", "get", name]);
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

    async closeTabIfOnlyPane({ tabId, paneId }) {
      try {
        const { tab } = await execHerdrJson<{ tab: TabInfo }>(["tab", "get", tabId]);
        if (tab.pane_count !== 1) {
          return "kept";
        }
        const panes = await execHerdrJson<{ panes: PaneInfo[] }>(["pane", "list", "--workspace", tab.workspace_id]);
        const tabPanes = panes.panes.filter((pane) => pane.tab_id === tabId);
        if (tabPanes.length !== 1 || tabPanes[0]?.pane_id !== paneId) {
          return "kept";
        }
        await execHerdrJson(["tab", "close", tabId]);
        return "closed";
      } catch {
        return "kept";
      }
    },
  };
}
