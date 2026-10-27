import type { HerdrHost } from "../herdr/index.ts";
import type { ProfileCatalog } from "../profile/index.ts";
import type { SessionReader } from "../session-file/index.ts";
import type { ResultHandler } from "./result.ts";

export interface RunServiceDeps {
  host: HerdrHost;
  readLastAssistant: SessionReader;
  loadProfiles: () => ProfileCatalog;
  maxConcurrent: number;
  maxResultChars: number;
}

export interface RunRecord {
  name: string;
  profileName: string;
  paneId: string;
  paneLabel: string;
  sessionFile: string;
  tabId: string;
  lastHandledSeq: number;
  timer?: ReturnType<typeof setTimeout>;
  pollFailures: number;
  live: boolean;
}

export interface RunState extends RunServiceDeps {
  sessionsDir: string;
  runs: RunRecord[];
  resultHandler: ResultHandler | undefined;
  nextName(profile: string): string;
  active(): string[];
  available(): string[];
  clearTimer(run: RunRecord): void;
  settle(run: RunRecord): void;
  release(run: RunRecord): void;
  schedule(run: RunRecord, delayMs: number, task: () => void): void;
}
