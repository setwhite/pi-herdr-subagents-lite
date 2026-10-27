import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGE_SUFFIX = ".md";
const DELIVERED_DIR = ".delivered";

function inboxDir(sessionFile: string): string {
  return `${sessionFile}.inbox`;
}

export function hasInbox(sessionFile: string): boolean {
  try {
    return statSync(inboxDir(sessionFile)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function createInbox(sessionFile: string): void {
  mkdirSync(inboxDir(sessionFile), { recursive: true });
}

export function removeInbox(sessionFile: string): void {
  rmSync(inboxDir(sessionFile), { recursive: true, force: true });
}

function pendingNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(MESSAGE_SUFFIX))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function inboxCount(sessionFile: string): number {
  return pendingNames(inboxDir(sessionFile)).length;
}

export function enqueue(sessionFile: string, text: string): void {
  const dir = inboxDir(sessionFile);
  mkdirSync(dir, { recursive: true });
  const name = `${String(process.hrtime.bigint()).padStart(20, "0")}-${randomUUID()}${MESSAGE_SUFFIX}`;
  const temp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(temp, text, "utf8");
  renameSync(temp, join(dir, name));
}

export function drain(sessionFile: string, deliver: (text: string) => void): number {
  const dir = inboxDir(sessionFile);
  const names = pendingNames(dir);
  if (names.length === 0) {
    return 0;
  }

  const deliveredDir = join(dir, DELIVERED_DIR);
  mkdirSync(deliveredDir, { recursive: true });
  let delivered = 0;
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    deliver(text);
    renameSync(join(dir, name), join(deliveredDir, name));
    delivered += 1;
  }
  return delivered;
}

export { pumpInbox } from "./pump.ts";
