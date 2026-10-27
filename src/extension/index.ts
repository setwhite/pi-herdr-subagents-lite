import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { Config } from "../config/index.ts";
import type { HerdrHost } from "../herdr/index.ts";
import { drain, hasInbox } from "../inbox/index.ts";
import type { ProfileCatalog, ProfileSources } from "../profile/index.ts";
import { createRunService, type RunService } from "../run/index.ts";
import type { SessionReader } from "../session/index.ts";
import { createTool, type ResultMessage, type SubagentTool, sendResult } from "../tool/index.ts";

export interface ExtensionDeps {
  host: HerdrHost;
  readLastAssistant: SessionReader;
  loadConfig: () => Config;
  loadProfiles: (sources: ProfileSources) => ProfileCatalog;
}

export interface SessionContext {
  cwd: string;
  isProjectTrusted(): boolean;
  sessionManager: { getSessionFile(): string | undefined };
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

export type { SubagentTool };

type SessionStartHandler = (event: SessionStartEvent, ctx: SessionContext) => void;

export interface ExtensionRegistrar {
  on(event: "session_start", handler: SessionStartHandler): void;
  on(event: "session_shutdown", handler: () => void): void;
  registerTool(tool: SubagentTool): void;
  sendMessage(message: ResultMessage, options?: { triggerTurn?: boolean }): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

const INBOX_FAILURE_LIMIT = 3;

export function createExtension(deps: ExtensionDeps): (pi: ExtensionRegistrar) => void {
  return (pi: ExtensionRegistrar) => {
    const config = deps.loadConfig();
    let service: RunService | undefined;
    let inboxTimer: ReturnType<typeof setInterval> | undefined;
    let inboxFailures = 0;

    const stopInbox = () => {
      if (inboxTimer !== undefined) {
        clearInterval(inboxTimer);
        inboxTimer = undefined;
      }
    };

    const startInbox = (ctx: SessionContext) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile || !hasInbox(sessionFile)) {
        return;
      }
      inboxFailures = 0;
      inboxTimer = setInterval(() => {
        try {
          drain(sessionFile, (text) => {
            const options = ctx.isIdle() ? undefined : { deliverAs: "steer" as const };
            pi.sendUserMessage(text, options);
          });
          inboxFailures = 0;
        } catch (error) {
          inboxFailures += 1;
          if (inboxFailures < INBOX_FAILURE_LIMIT) {
            return;
          }
          stopInbox();
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`inbox: stopped after ${INBOX_FAILURE_LIMIT} delivery failures: ${detail}`, "error");
        }
      }, config.inboxPollMs);
      inboxTimer.unref?.();
    };

    const startService = (sources: ProfileSources) => {
      service?.shutdown();
      service = createRunService({
        host: deps.host,
        readLastAssistant: deps.readLastAssistant,
        loadProfiles: () => deps.loadProfiles(sources),
        maxConcurrent: config.maxConcurrent,
        maxResultChars: config.maxResultChars,
      });
      service.onResult((result) => sendResult(pi, result));
    };

    pi.on("session_start", (_event, ctx) => {
      stopInbox();
      const sources = { cwd: ctx.cwd, trusted: ctx.isProjectTrusted() };
      startService(sources);
      if (config.enabled) {
        const profiles = deps.loadProfiles(sources).profiles;
        pi.registerTool(createTool({ config, profiles, service: currentService }));
      }
      startInbox(ctx);
    });

    pi.on("session_shutdown", () => {
      stopInbox();
      service?.shutdown();
      service = undefined;
    });

    const currentService = (): RunService => {
      if (!service) {
        throw new Error("subagent service is not started");
      }
      return service;
    };
  };
}
