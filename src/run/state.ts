import type { HerdrHost } from "../herdr/index.ts";
import type { ProfileCatalog } from "../profile/index.ts";
import type { ExitReceiptReader, SessionReader } from "../session-file/index.ts";
import type { Aggregator } from "./aggregate.ts";
import type { ResultHandler, RunResult } from "./result.ts";

export interface RunServiceDeps {
  host: HerdrHost;
  readLastAssistant: SessionReader;
  readExitReceipt: ExitReceiptReader;
  loadProfiles: () => ProfileCatalog;
  trusted: boolean;
  toolName: string;
  maxConcurrent: number;
  maxResultChars: number;
  aggregateWindowMs: number;
  pollIntervalMs: number;
  onDeliveryError: (error: unknown) => void;
}

export interface RunRecord {
  name: string;
  profileName: string;
  paneId: string;
  paneLabel: string;
  sessionFile: string;
  cwd: string;
  tabId: string;
  autoExit: boolean;
  lastHandledSeq: number;
  lastDeliveredText: string | null;
  artifactSeq: number;
  timer?: ReturnType<typeof setTimeout>;
  pollFailures: number;
  live: boolean;
}

export interface RunState extends RunServiceDeps {
  sessionsDir: string;
  runs: RunRecord[];
  resultHandler: ResultHandler | undefined;
  results: Aggregator<RunResult> | undefined;
  pollTimer?: ReturnType<typeof setTimeout>;
  pollBusy: boolean;
  nextName(profile: string): string;
  active(): string[];
  available(): string[];
  clearTimer(run: RunRecord): void;
  settle(run: RunRecord): void;
  release(run: RunRecord): void;
  schedule(run: RunRecord, delayMs: number, task: () => void): void;
}
