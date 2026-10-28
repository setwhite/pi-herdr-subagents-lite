import { writeArtifact } from "./artifact.ts";
import type { RunRecord } from "./state.ts";
import { leadingChars } from "./truncate.ts";

export interface DoneResult {
  state: "done";
  name: string;
  text: string;
  artifact?: string;
  warning?: string;
  sessionFile: string;
  paneId: string;
}

export type UnknownReason = "poll_failed" | "no_result" | "close_failed" | "quitted" | "pane_exited";

export interface UnknownResult {
  state: "unknown";
  name: string;
  reason: UnknownReason;
  sessionFile: string;
  paneId: string;
}

export type RunResult = DoneResult | UnknownResult;

export type ResultHandler = (results: RunResult[]) => void | Promise<void>;

export function doneResult(run: RunRecord, text: string, limit: number): DoneResult {
  const base = { state: "done" as const, name: run.name, sessionFile: run.sessionFile, paneId: run.paneId };
  if (text.length <= limit) {
    return { ...base, text };
  }
  const head = leadingChars(text, limit);
  const seq = run.artifactSeq + 1;
  try {
    const artifact = writeArtifact(run.sessionFile, seq, text);
    run.artifactSeq = seq;
    return { ...base, text: head, artifact };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ...base, text: head, warning: `[artifact write failed: ${detail}]` };
  }
}

export function unknownResult(run: RunRecord, reason: UnknownReason): UnknownResult {
  return {
    state: "unknown",
    name: run.name,
    reason,
    sessionFile: run.sessionFile,
    paneId: run.paneId,
  };
}
