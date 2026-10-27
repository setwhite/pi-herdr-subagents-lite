import { writeFileSync } from "node:fs";

export type ExitReceiptWriter = (sessionFile: string, reason: string) => void;

export const writeExitReceipt: ExitReceiptWriter = (sessionFile, reason) => {
  writeFileSync(`${sessionFile}.exit`, JSON.stringify({ reason }));
};
