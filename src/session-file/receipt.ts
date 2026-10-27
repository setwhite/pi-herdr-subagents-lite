import { readFileSync, writeFileSync } from "node:fs";

export interface ExitReceipt {
  reason: string;
}

export type ExitReceiptReader = (sessionFile: string) => ExitReceipt | null;

export type ExitReceiptWriter = (sessionFile: string, reason: string) => void;

export const readExitReceipt: ExitReceiptReader = (sessionFile) => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(`${sessionFile}.exit`, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("reason" in parsed) || typeof parsed.reason !== "string") {
      return null;
    }
    return { reason: parsed.reason };
  } catch {
    return null;
  }
};

export const writeExitReceipt: ExitReceiptWriter = (sessionFile, reason) => {
  writeFileSync(`${sessionFile}.exit`, JSON.stringify({ reason }));
};
