import { leadingChars } from "./truncate.ts";

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

export type RunResult = DoneResult | UnknownResult;

export type ResultHandler = (result: RunResult) => void | Promise<void>;

export function resultText(text: string, limit: number, sessionFile: string): string {
  if (text.length <= limit) {
    return text;
  }
  return `${leadingChars(text, limit)}\n\n[truncated at ${limit} characters]\n\nSession: ${sessionFile}`;
}
