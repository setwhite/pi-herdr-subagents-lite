import type { RunRecord } from "./state.ts";
import { leadingChars } from "./truncate.ts";

export interface DoneResult {
  state: "done";
  name: string;
  text: string;
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

export type ResultHandler = (result: RunResult) => void | Promise<void>;

export function resultText(text: string, limit: number, sessionFile: string): string {
  if (text.length <= limit) {
    return text;
  }
  return `${leadingChars(text, limit)}\n\n[truncated at ${limit} characters]\n\nSession: ${sessionFile}`;
}

export function doneResult(run: RunRecord, text: string, limit: number): DoneResult {
  return {
    state: "done",
    name: run.name,
    text: resultText(text, limit, run.sessionFile),
    sessionFile: run.sessionFile,
    paneId: run.paneId,
  };
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
