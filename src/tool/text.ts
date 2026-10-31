import type { Config } from "../config/index.ts";
import type { Profile } from "../profile/index.ts";
import { profileLabel } from "../run/index.ts";

const DEFAULT_DESCRIPTION = "Run subagents and send them messages.";
const DEFAULT_SNIPPET = "";
const DEFAULT_GUIDELINES = [
  "Available profiles:\n{{profiles}}",
  "run only starts the subagent; the result comes back automatically as a message.",
  "send only delivers; state tracking is not needed.",
];

export function toolText(config: Config, profiles: Profile[]) {
  const visible = profiles.filter((profile) => !profile.disableModelInvocation);
  const profileLines = visible.length === 0 ? "none" : visible.map(profileLabel).join("\n");
  return {
    description: config.prompts.description ?? DEFAULT_DESCRIPTION,
    promptSnippet: config.prompts.snippet ?? DEFAULT_SNIPPET,
    promptGuidelines: (config.prompts.guidelines ?? DEFAULT_GUIDELINES).map(
      (line) => `${config.toolName}: ${line.replaceAll("{{profiles}}", profileLines)}`,
    ),
  };
}
