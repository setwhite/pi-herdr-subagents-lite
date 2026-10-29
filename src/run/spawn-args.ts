import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Profile, skillPath } from "../profile/index.ts";

export const AUTO_EXIT_ENV = "PI_SUBAGENT_AUTO_EXIT";

export function parentCwd(): string {
  return process.cwd();
}

export function resolveCwd(raw: string | undefined): string {
  if (raw === undefined) {
    return parentCwd();
  }
  const expanded = raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\") ? join(homedir(), raw.slice(1)) : raw;
  return resolve(parentCwd(), expanded);
}

export function agentArgs(profile: Profile, identityFile: string, toolName: string): string[] {
  const args: string[] = [];
  if (profile.model !== undefined) {
    args.push("--model", profile.model);
  }
  if (profile.thinking !== undefined) {
    args.push("--thinking", profile.thinking);
  }
  if (profile.tools === undefined) {
    args.push("--tools", `-${toolName}`);
  } else {
    args.push(...(profile.tools === "" ? ["--no-tools"] : ["--tools", profile.tools]));
  }
  if (profile.skills !== undefined) {
    args.push("--no-skills");
    for (const name of profile.skills) {
      args.push("--skill", skillPath(name));
    }
  }
  if (profile.systemPrompt === "append") {
    args.push("--append-system-prompt", identityFile);
  } else if (profile.systemPrompt === "replace") {
    args.push("--system-prompt", identityFile);
  }
  return args;
}

export function briefText(profile: Profile, task: string): string {
  const lead = profile.systemPrompt === "task" && profile.body !== "" ? `${profile.body}\n\n` : "";
  return `${lead}# Task\n${task}\n`;
}
