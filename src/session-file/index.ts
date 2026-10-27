import { readFileSync } from "node:fs";
import { parseLastAssistant, type SessionSnapshot } from "./jsonl.ts";

export { type ExitReceiptWriter, writeExitReceipt } from "./receipt.ts";

export type SessionReader = (path: string) => SessionSnapshot;

export const readLastAssistant: SessionReader = (path) => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { text: null, pendingToolCall: false };
  }
  return parseLastAssistant(raw);
};
