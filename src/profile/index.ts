import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export { EXAMPLE_PROFILE, EXAMPLE_PROFILE_FILE } from "./examples.ts";
export type { Profile } from "./frontmatter.ts";
export {
  globalProfilesDir,
  loadProfiles,
  type ProfileCatalog,
  type ProfileSources,
  seedExampleProfile,
} from "./layers.ts";

export function agentDir(): string {
  return getAgentDir();
}

export function skillPath(name: string): string {
  return join(agentDir(), "skills", name);
}
