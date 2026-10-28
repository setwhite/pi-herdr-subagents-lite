import { join } from "node:path";
import { dataDir } from "../config/index.ts";
import { agentDir } from "../profile/index.ts";
import { createNamer } from "./naming.ts";
import { stopPoll } from "./poll.ts";
import type { QuestionHandler } from "./question.ts";
import type { ResultHandler } from "./result.ts";
import { type SendResult, send } from "./send.ts";
import { type RunStarted, start } from "./start.ts";
import type { RunServiceDeps, RunState } from "./state.ts";

export interface RunService {
  run(profile: string, task: string): Promise<RunStarted>;
  send(name: string, message: string): Promise<SendResult>;
  onResult(handler: ResultHandler): void;
  onQuestion(handler: QuestionHandler): void;
  shutdown(): void;
  active(): string[];
}

export function createRunService(deps: RunServiceDeps): RunService {
  const state: RunState = {
    ...deps,
    sessionsDir: join(dataDir(agentDir()), "sessions"),
    runs: [],
    resultHandler: undefined,
    questionHandler: undefined,
    pollBusy: false,
    nextName: createNamer(),
    active() {
      return state.runs.filter((run) => run.live).map((run) => run.name);
    },
    available() {
      return state.runs.map((run) => run.name);
    },
    clearTimer(run) {
      if (run.timer !== undefined) {
        clearTimeout(run.timer);
        run.timer = undefined;
      }
    },
    settle(run) {
      run.live = false;
      state.clearTimer(run);
    },
    release(run) {
      state.settle(run);
      const index = state.runs.indexOf(run);
      if (index >= 0) {
        state.runs.splice(index, 1);
      }
    },
    schedule(run, delayMs, task) {
      if (!run.live) {
        return;
      }
      run.timer = setTimeout(task, delayMs);
      run.timer.unref?.();
    },
  };

  return {
    run: (profile, task) => start(state, profile, task),
    send: (name, message) => send(state, name, message),
    onResult(handler) {
      state.resultHandler = handler;
    },
    onQuestion(handler) {
      state.questionHandler = handler;
    },
    shutdown() {
      stopPoll(state);
      for (const run of state.runs) {
        state.settle(run);
      }
      state.runs.length = 0;
    },
    active: () => state.active(),
  };
}

export { ToolError } from "./errors.ts";
export type { QuestionHandler, RunQuestion } from "./question.ts";
export { profileLabel } from "./resolve.ts";
export type { ResultHandler, RunResult } from "./result.ts";
export type { SendResult } from "./send.ts";
export { AUTO_EXIT_ENV } from "./spawn-args.ts";
export type { RunStarted } from "./start.ts";
export type { RunServiceDeps };
