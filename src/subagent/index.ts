import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataDir } from "../config/index.ts";
import { type AgentSnapshot, type HerdrHost, HerdrHostError } from "../herdr/index.ts";
import { createInbox, enqueue, removeInbox } from "../inbox/index.ts";
import { agentDir, type Profile, type ProfileCatalog, skillPath } from "../profile/index.ts";
import type { SessionReader } from "../session/index.ts";

const NAME_ATTEMPTS = 100;
const PROFILE_SLUG_CHARS = 16;
const PANE_LABEL_CHARS = 32;
const POLL_INTERVAL_MS = 1000;
const POLL_FAILURE_LIMIT = 3;
const READ_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 200;

const WORKER_INSTRUCTIONS = `You are a worker subagent. Complete the task below in the current working directory.
Do not spawn subagents. If you need a decision and ask_user_question is available,
use it; the human answers in your pane. Otherwise, state the decision needed in your
final answer. Finish with a concise summary: what you did, where, and any open questions.`;

export interface RunStarted {
  state: "running";
  name: string;
  paneId: string;
  sessionFile: string;
}

export interface SentResult {
  state: "sent";
  name: string;
}

export interface DoneResult {
  state: "done";
  name: string;
  text: string;
  sessionFile: string;
  paneId: string;
}

export type UnknownReason = "agent_missing" | "poll_failed" | "no_result";

export interface UnknownResult {
  state: "unknown";
  name: string;
  reason: UnknownReason;
  sessionFile: string;
  paneId: string;
}

export type SubagentResult = DoneResult | UnknownResult;

export type ResultHandler = (result: SubagentResult) => void | Promise<void>;

export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export interface SubagentService {
  run(profile: string, task: string): Promise<RunStarted>;
  send(name: string, message: string): Promise<SentResult>;
  onResult(handler: ResultHandler): void;
  shutdown(): void;
  active(): string[];
}

export interface SubagentServiceDeps {
  host: HerdrHost;
  readLastAssistant: SessionReader;
  loadProfiles: () => ProfileCatalog;
  maxConcurrent: number;
  maxResultChars: number;
}

interface ActiveRun {
  name: string;
  profile: Profile;
  paneId: string;
  sessionFile: string;
  tabId: string;
  timer?: ReturnType<typeof setTimeout>;
  pollFailures: number;
  finished: boolean;
}

function profileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROFILE_SLUG_CHARS);
  if (slug === "") {
    return "worker";
  }
  return /^[a-z]/.test(slug) ? slug : `agent-${slug}`;
}

function leadingChars(text: string, limit: number): string {
  const last = text.charCodeAt(limit - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, cut);
}

function paneLabel(task: string): string {
  const line = task.split(/\r?\n/, 1)[0] ?? "";
  const text = line
    .replace(/\p{Cc}/gu, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return leadingChars(text, PANE_LABEL_CHARS);
}

function resultText(text: string, limit: number, sessionFile: string): string {
  if (text.length <= limit) {
    return text;
  }
  return `${leadingChars(text, limit)}\n\n[truncated at ${limit} characters]\n\nSession: ${sessionFile}`;
}

function agentArgs(profile: Profile, identityFile: string): string[] {
  const args: string[] = [];
  if (profile.model !== undefined) {
    args.push("--model", profile.model);
  }
  if (profile.thinking !== undefined) {
    args.push("--thinking", profile.thinking);
  }
  if (profile.tools !== undefined) {
    args.push(...(profile.tools === "" ? ["--no-tools"] : ["--tools", profile.tools]));
  }
  if (profile.skills !== undefined) {
    args.push("--no-skills");
    for (const name of profile.skills) {
      args.push("--skill", skillPath(name));
    }
  }
  if (profile.systemPrompt === "append") {
    args.push("--append-system-prompt", identityFile);
  } else if (profile.systemPrompt === "replace") {
    args.push("--system-prompt", identityFile);
  }
  return args;
}

function briefText(profile: Profile, task: string): string {
  const lead = profile.systemPrompt === "task" && profile.body !== "" ? `${profile.body}\n\n` : "";
  return `${lead}${WORKER_INSTRUCTIONS}\n\n# Task\n${task}\n`;
}

export function profileLabel(profile: Profile): string {
  return profile.description === "" ? profile.displayName : `${profile.displayName} — ${profile.description}`;
}

function resolveProfile({ profiles, problems }: ProfileCatalog, name: string): Profile {
  const invalid = problems.filter((problem) => problem.name === name);
  if (invalid.length > 0) {
    throw new ToolError(
      "profile_invalid",
      invalid.map((problem) => `${problem.file}: ${problem.field}: ${problem.reason}`).join("; "),
    );
  }
  const profile = profiles.find((candidate) => candidate.name === name);
  if (profile) {
    return profile;
  }
  const available = profiles.length === 0 ? "none" : profiles.map(profileLabel).join(", ");
  throw new ToolError("unknown_profile", `unknown profile "${name}"; available: ${available}`);
}

function spawnFailed(error: unknown, paneId: string | undefined): ToolError {
  const detail = error instanceof Error ? error.message : String(error);
  const created = paneId ? `; pane ${paneId} was created` : "";
  const trust =
    error instanceof HerdrHostError && error.code === "agent_not_ready"
      ? " and is likely waiting at a trust dialog; answer it in that pane, then run again"
      : "";
  return new ToolError("spawn_failed", `${detail}${created}${trust}`);
}

export function createSubagentService({
  host,
  readLastAssistant,
  loadProfiles,
  maxConcurrent,
  maxResultChars,
}: SubagentServiceDeps): SubagentService {
  const runs: ActiveRun[] = [];
  const sessionsDir = join(dataDir(agentDir()), "sessions");
  const nameCounters = new Map<string, number>();
  let resultHandler: ResultHandler | undefined;

  const nextName = (profile: string) => {
    const slug = profileSlug(profile);
    const number = nameCounters.get(slug) ?? 1;
    nameCounters.set(slug, number + 1);
    return `${slug}-${number}`;
  };
  const active = () => runs.map((run) => run.name);

  function clearTimer(run: ActiveRun) {
    if (run.timer !== undefined) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
  }

  function release(run: ActiveRun) {
    run.finished = true;
    clearTimer(run);
    const index = runs.indexOf(run);
    if (index >= 0) {
      runs.splice(index, 1);
    }
  }

  function schedule(run: ActiveRun, delayMs: number, task: () => void) {
    if (run.finished) {
      return;
    }
    run.timer = setTimeout(task, delayMs);
    run.timer.unref?.();
  }

  function schedulePoll(run: ActiveRun) {
    schedule(run, POLL_INTERVAL_MS, () => void poll(run));
  }

  function unknown(run: ActiveRun, reason: UnknownReason): UnknownResult {
    return {
      state: "unknown",
      name: run.name,
      reason,
      sessionFile: run.sessionFile,
      paneId: run.paneId,
    };
  }

  async function finish(run: ActiveRun, result: SubagentResult) {
    try {
      await resultHandler?.(result);
      if (result.state === "done") {
        try {
          await host.closeTabIfOnlyPane({ tabId: run.tabId, paneId: run.paneId });
        } catch {
          // The result is delivered; a failed close leaves the tab for a human.
        }
      }
    } finally {
      release(run);
    }
  }

  async function poll(run: ActiveRun) {
    run.timer = undefined;
    if (run.finished) {
      return;
    }

    let snapshot: AgentSnapshot | null;
    try {
      snapshot = await host.getAgent(run.name);
    } catch {
      if (run.finished) {
        return;
      }
      run.pollFailures += 1;
      if (run.pollFailures >= POLL_FAILURE_LIMIT) {
        await finish(run, unknown(run, "poll_failed"));
        return;
      }
      schedulePoll(run);
      return;
    }
    if (run.finished) {
      return;
    }
    run.pollFailures = 0;

    if (!snapshot) {
      await finish(run, unknown(run, "agent_missing"));
      return;
    }

    if (snapshot.completionSeq > 0 && (snapshot.status === "idle" || snapshot.status === "done")) {
      await readResult(run, 1);
      return;
    }

    schedulePoll(run);
  }

  async function readResult(run: ActiveRun, attempt: number) {
    run.timer = undefined;
    if (run.finished) {
      return;
    }

    const snapshot = readLastAssistant(run.sessionFile);
    if (snapshot.pendingToolCall) {
      schedulePoll(run);
      return;
    }
    if (snapshot.text !== null) {
      await finish(run, {
        state: "done",
        name: run.name,
        text: resultText(snapshot.text, maxResultChars, run.sessionFile),
        sessionFile: run.sessionFile,
        paneId: run.paneId,
      });
      return;
    }

    if (attempt >= READ_ATTEMPTS) {
      await finish(run, unknown(run, "no_result"));
      return;
    }

    schedule(run, READ_RETRY_DELAY_MS, () => void readResult(run, attempt + 1));
  }

  return {
    async run(profileName, task) {
      const profile = resolveProfile(loadProfiles(), profileName);
      if (runs.length >= maxConcurrent) {
        const names = active().join(", ");
        throw new ToolError("max_concurrent", `already running ${names}; wait for a result or close one`);
      }

      const runId = randomUUID();
      const files = (name: string) => {
        const sessionFile = join(sessionsDir, `${name}-${runId}.jsonl`);
        return {
          sessionFile,
          briefFile: `${sessionFile}.brief.md`,
          identityFile: `${sessionFile}.identity.md`,
        };
      };
      const name = nextName(profileName);
      let current = files(name);
      const run: ActiveRun = {
        name,
        profile,
        paneId: "",
        sessionFile: current.sessionFile,
        tabId: "",
        pollFailures: 0,
        finished: false,
      };
      // Reserve the slot before the first await: concurrent run() calls must see it.
      runs.push(run);

      try {
        const cwd = profile.cwd === undefined ? process.cwd() : resolve(process.cwd(), profile.cwd);
        const tab = await host.createTab({ cwd, label: run.name });
        run.tabId = tab.tabId;
        run.paneId = tab.paneId;
        await host.renamePane({ paneId: tab.paneId, label: paneLabel(task) || run.name });
        await mkdir(sessionsDir, { recursive: true });

        for (let retry = 1; ; retry++) {
          await writeFile(current.briefFile, briefText(profile, task), "utf8");
          if (profile.systemPrompt !== "task") {
            await writeFile(current.identityFile, profile.body, "utf8");
          }
          await createInbox(current.sessionFile);
          try {
            await host.startAgent({
              name: run.name,
              paneId: tab.paneId,
              sessionFile: current.sessionFile,
              briefFile: current.briefFile,
              agentArgs: agentArgs(profile, current.identityFile),
            });
            break;
          } catch (error) {
            if (!(error instanceof HerdrHostError && error.code === "name_taken")) {
              throw error;
            }
            await Promise.all([
              rm(current.briefFile, { force: true }),
              rm(current.identityFile, { force: true }),
              removeInbox(current.sessionFile),
            ]);
            if (retry >= NAME_ATTEMPTS) {
              throw new ToolError(
                "name_exhausted",
                `no free name for "${profileSlug(profileName)}" after ${NAME_ATTEMPTS} attempts`,
              );
            }
            run.name = nextName(profileName);
            await host.renameTab({ tabId: tab.tabId, label: run.name });
            current = files(run.name);
            run.sessionFile = current.sessionFile;
          }
        }

        schedulePoll(run);

        return {
          state: "running",
          name: run.name,
          paneId: run.paneId,
          sessionFile: run.sessionFile,
        };
      } catch (error) {
        release(run);
        if (error instanceof ToolError) {
          throw error;
        }
        throw spawnFailed(error, run.paneId || undefined);
      }
    },

    async send(name, message) {
      const run = runs.find((candidate) => candidate.name === name);
      if (!run) {
        const names = active();
        const available = names.length === 0 ? "none" : names.join(", ");
        throw new ToolError("unknown_agent", `unknown agent "${name}"; available: ${available}`);
      }
      await enqueue(run.sessionFile, `[from parent]\n\n${message}\n`);
      return { state: "sent", name };
    },

    onResult(handler) {
      resultHandler = handler;
    },

    shutdown() {
      for (const run of runs) {
        run.finished = true;
        clearTimer(run);
      }
      runs.length = 0;
    },

    active,
  };
}
