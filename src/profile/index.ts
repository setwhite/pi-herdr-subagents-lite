import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type SystemPromptMode = "append" | "replace" | "task";

export interface Profile {
  name: string;
  displayName: string;
  description: string;
  body: string;
  model: string | undefined;
  thinking: Thinking | undefined;
  tools: string | undefined;
  skills: string[] | undefined;
  cwd: string | undefined;
  systemPrompt: SystemPromptMode;
  autoExit: boolean;
  disableModelInvocation: boolean;
}

export interface ProfileProblem {
  name: string;
  file: string;
  field: string;
  reason: string;
}

export interface ProfileCatalog {
  profiles: Profile[];
  problems: ProfileProblem[];
}

export interface ProfileSources {
  cwd: string;
  trusted: boolean;
}

const THINKING_LEVELS: readonly Thinking[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const SYSTEM_PROMPT_MODES: readonly SystemPromptMode[] = ["append", "replace", "task"];

type Raw = Record<string, unknown>;

interface Fields {
  raw: Raw;
  name: string;
  file: string;
  problems: ProfileProblem[];
}

function isRaw(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function complain(fields: Fields, field: string, reason: string) {
  fields.problems.push({ name: fields.name, file: fields.file, field, reason });
}

function stringField(fields: Fields, key: string): string | undefined {
  const value = fields.raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    complain(fields, key, `expected string, got ${typeName(value)}`);
    return undefined;
  }
  return value;
}

function enumField<T extends string>(fields: Fields, key: string, allowed: readonly T[]): T | undefined {
  const value = stringField(fields, key);
  if (value === undefined) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  complain(fields, key, `expected one of ${allowed.join(", ")}`);
  return undefined;
}

function booleanField(fields: Fields, key: string): boolean | undefined {
  const value = fields.raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    complain(fields, key, `expected boolean, got ${typeName(value)}`);
    return undefined;
  }
  return value;
}

function toolsField(fields: Fields): string | undefined {
  const value = stringField(fields, "tools");
  if (value === undefined || value === "") {
    return value;
  }
  const entries = value.split(",").map((entry) => entry.trim());
  const signed = entries.filter((entry) => entry.startsWith("+") || entry.startsWith("-"));
  const broken = entries.some((entry) => entry === "" || entry === "+" || entry === "-");
  if (broken || (signed.length > 0 && signed.length < entries.length)) {
    complain(fields, "tools", "expected comma-separated names, or +name/-name entries, not both");
    return undefined;
  }
  return value;
}

function skillsField(fields: Fields): string[] | undefined {
  const value = fields.raw.skills;
  if (value === undefined) {
    return undefined;
  }
  if (value === "") {
    return [];
  }
  const names = typeof value === "string" ? [value] : value;
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
    complain(fields, "skills", "expected a name or a list of names");
    return undefined;
  }
  const named = names as string[];
  if (named.some((name) => name === "" || name.startsWith("+") || name.startsWith("-"))) {
    complain(fields, "skills", "expected skill names, without + / - prefixes");
    return undefined;
  }
  return named;
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

export function skillPath(name: string): string {
  return join(getAgentDir(), "skills", name);
}

function readAgentsDir(dir: string): ProfileCatalog {
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
  const global = readAgentsDir(join(getAgentDir(), "agents"));
  if (!trusted) {
    return global;
  }

  const project = readAgentsDir(join(cwd, ".pi", "agents"));
  const projectNames = new Set([
    ...project.profiles.map((profile) => profile.name),
    ...project.problems.map((problem) => problem.name),
  ]);
  const profiles = [...global.profiles.filter((profile) => !projectNames.has(profile.name)), ...project.profiles];
  const problems = [...global.problems.filter((problem) => !projectNames.has(problem.name)), ...project.problems];
  profiles.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { profiles, problems };
}
