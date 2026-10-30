import { readFileSync } from "node:fs";
import { parseLastAssistant, type SessionSnapshot } from "./jsonl.ts";

export {
  type ExitReceipt,
  type ExitReceiptReader,
  type ExitReceiptWriter,
  readExitReceipt,
  writeExitReceipt,
} from "./receipt.ts";

export type SessionReader = (path: string) => SessionSnapshot;

export const readLastAssistant: SessionReader = (path) => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { text: null, pendingToolCall: false, empty: true };
  }
  return parseLastAssistant(raw);
};
