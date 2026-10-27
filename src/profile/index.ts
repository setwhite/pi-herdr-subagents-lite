import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type { Profile } from "./frontmatter.ts";
export { loadProfiles, type ProfileCatalog, type ProfileSources } from "./layers.ts";

export function agentDir(): string {
  return getAgentDir();
}

export function skillPath(name: string): string {
  return join(agentDir(), "skills", name);
}
