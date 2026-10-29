import type { Profile, ProfileCatalog } from "../profile/index.ts";
import { ToolError } from "./errors.ts";

export function profileLabel(profile: Profile): string {
  const label = profile.displayName === profile.name ? profile.name : `${profile.name} (${profile.displayName})`;
  return profile.description === "" ? label : `${label} — ${profile.description}`;
}

export function resolveProfile({ profiles, problems }: ProfileCatalog, name: string): Profile {
  const invalid = problems.filter((problem) => problem.name === name);
  if (invalid.length > 0) {
    throw new ToolError(
      "profile_invalid",
      invalid.map((problem) => `${problem.file}: ${problem.field}: ${problem.reason}`).join("; "),
    );
  }
  const profile = profiles.find((candidate) => candidate.name === name);
  if (profile) {
    return profile;
  }
  const available = profiles.length === 0 ? "none" : profiles.map(profileLabel).join(", ");
  throw new ToolError("unknown_profile", `unknown profile "${name}"; available: ${available}`);
}
