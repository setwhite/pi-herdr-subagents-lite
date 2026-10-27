import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { dataDir, isRaw } from "../config/index.ts";
import {
  booleanField,
  enumField,
  type Fields,
  type Profile,
  type ProfileProblem,
  SYSTEM_PROMPT_MODES,
  skillsField,
  stringField,
  THINKING_LEVELS,
  toolsField,
} from "./frontmatter.ts";

export interface ProfileCatalog {
  profiles: Profile[];
  problems: ProfileProblem[];
}

export interface ProfileSources {
  cwd: string;
  trusted: boolean;
}

function parseProfile(file: string, source: string): { profile?: Profile; problems: ProfileProblem[] } {
  const name = basename(file, ".md");
  let frontmatter: unknown;
  let body: string;
  try {
    ({ frontmatter, body } = parseFrontmatter(source));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "parse failed";
    return { problems: [{ name, file, field: "frontmatter", reason }] };
  }
  if (!isRaw(frontmatter)) {
    return { problems: [{ name, file, field: "frontmatter", reason: "expected a mapping" }] };
  }

  const problems: ProfileProblem[] = [];
  const fields: Fields = { raw: frontmatter, name, file, problems };
  const profile: Profile = {
    name,
    displayName: stringField(fields, "name") ?? name,
    description: stringField(fields, "description") ?? "",
    body,
    model: stringField(fields, "model"),
    thinking: enumField(fields, "thinking", THINKING_LEVELS),
    tools: toolsField(fields),
    skills: skillsField(fields),
    cwd: stringField(fields, "cwd"),
    systemPrompt: enumField(fields, "system-prompt", SYSTEM_PROMPT_MODES) ?? "append",
    autoExit: booleanField(fields, "auto-exit") ?? false,
    disableModelInvocation: booleanField(fields, "disable-model-invocation") ?? false,
  };
  return problems.length === 0 ? { profile, problems } : { problems };
}

function readProfilesDir(dir: string): ProfileCatalog {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith(".md"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { profiles: [], problems: [] };
    }
    throw error;
  }

  const profiles: Profile[] = [];
  const problems: ProfileProblem[] = [];
  for (const entry of entries.sort()) {
    const file = join(dir, entry);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unreadable";
      problems.push({ name: basename(entry, ".md"), file, field: "file", reason });
      continue;
    }
    const parsed = parseProfile(file, source);
    if (parsed.profile) {
      profiles.push(parsed.profile);
    }
    problems.push(...parsed.problems);
  }
  return { profiles, problems };
}

export function loadProfiles({ cwd, trusted }: ProfileSources): ProfileCatalog {
  const global = readProfilesDir(join(dataDir(getAgentDir()), "profiles"));
  if (!trusted) {
    return global;
  }

  const project = readProfilesDir(join(dataDir(join(cwd, ".pi")), "profiles"));
  const projectNames = new Set([
    ...project.profiles.map((profile) => profile.name),
    ...project.problems.map((problem) => problem.name),
  ]);
  const profiles = [...global.profiles.filter((profile) => !projectNames.has(profile.name)), ...project.profiles];
  const problems = [...global.problems.filter((problem) => !projectNames.has(problem.name)), ...project.problems];
  profiles.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { profiles, problems };
}
