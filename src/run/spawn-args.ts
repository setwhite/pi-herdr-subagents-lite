import { resolve } from "node:path";
import { type Profile, skillPath } from "../profile/index.ts";

const WORKER_INSTRUCTIONS = `You are a worker subagent. Complete the task below in the current working directory.
Do not spawn subagents. When you need a decision, use ask_user_question if it is available;
the human answers in your pane. Otherwise state the decision in your final answer.
End with a short summary: what you did, where, and what is open.`;

export function profileCwd(profile: Profile): string {
  return profile.cwd === undefined ? process.cwd() : resolve(process.cwd(), profile.cwd);
}

export function agentArgs(profile: Profile, identityFile: string): string[] {
  const args: string[] = [];
  if (profile.model !== undefined) {
    args.push("--model", profile.model);
  }
  if (profile.thinking !== undefined) {
    args.push("--thinking", profile.thinking);
  }
  if (profile.tools !== undefined) {
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
  return `${lead}${WORKER_INSTRUCTIONS}\n\n# Task\n${task}\n`;
}
