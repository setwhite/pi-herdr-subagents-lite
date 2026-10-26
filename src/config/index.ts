import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BlockedKind = "custom" | "select" | "confirm" | "input" | "editor";
export type ShutdownReason = "new" | "resume" | "fork" | "quit" | "reload";

export interface PromptOverrides {
  description?: string;
  snippet?: string;
  guidelines?: string[];
}

export interface Config {
  enabled: boolean;
  toolName: string;
  maxConcurrent: number;
  maxResultChars: number;
  aggregateWindowMs: number;
  closeChildrenOn: ShutdownReason[];
  inboxPollMs: number;
  prompts: PromptOverrides;
  bridge: { enabled: boolean; blockedOn: BlockedKind[] };
}

const CONFIG_KEYS = [
  "enabled",
  "toolName",
  "maxConcurrent",
  "maxResultChars",
  "aggregateWindowMs",
  "closeChildrenOn",
  "inboxPollMs",
  "prompts",
  "bridge",
];
const BRIDGE_KEYS = ["enabled", "blockedOn"];
const PROMPT_KEYS = ["description", "snippet", "guidelines"];
const BLOCKED_KINDS: readonly BlockedKind[] = ["custom", "select", "confirm", "input", "editor"];
const SHUTDOWN_REASONS: readonly ShutdownReason[] = ["new", "resume", "fork", "quit", "reload"];
const TOOL_NAME = /^[a-z][a-z0-9_]{0,31}$/;

type Raw = Record<string, unknown>;

interface Scope {
  raw: Raw;
  prefix: string;
  problems: string[];
}

function isRaw(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(scope: Scope, key: string, known: string[]): Scope {
  const value = scope.raw[key];
  if (value !== undefined && !isRaw(value)) {
    scope.problems.push(`${scope.prefix}${key}: expected object`);
  }
  const nested: Scope = { raw: isRaw(value) ? value : {}, prefix: `${scope.prefix}${key}.`, problems: scope.problems };
  unknownKeys(nested, known);
  return nested;
}

function unknownKeys(scope: Scope, known: string[]): void {
  for (const key of Object.keys(scope.raw)) {
    if (!known.includes(key)) {
      scope.problems.push(`${scope.prefix}${key}: unknown key`);
    }
  }
}

function integer(scope: Scope, key: string, fallback: number, min: number, max: number): number {
  const value = scope.raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    scope.problems.push(`${scope.prefix}${key}: expected integer`);
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function boolean(scope: Scope, key: string, fallback: boolean): boolean {
  const value = scope.raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    scope.problems.push(`${scope.prefix}${key}: expected boolean`);
    return fallback;
  }
  return value;
}

function optionalString(scope: Scope, key: string): string | undefined {
  const value = scope.raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    scope.problems.push(`${scope.prefix}${key}: expected string`);
    return undefined;
  }
  return value;
}

function stringArray(scope: Scope, key: string): string[] | undefined {
  const value = scope.raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  scope.problems.push(`${scope.prefix}${key}: expected string array`);
  return undefined;
}

function toolName(scope: Scope): string {
  const value = optionalString(scope, "toolName");
  if (value === undefined) {
    return "subagent";
  }
  if (!TOOL_NAME.test(value)) {
    scope.problems.push(`toolName: expected a name matching ${TOOL_NAME.source}`);
    return "subagent";
  }
  return value;
}

function enumList<T extends string>(scope: Scope, key: string, allowed: readonly T[], fallback: readonly T[]): T[] {
  const value = scope.raw[key];
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value)) {
    scope.problems.push(`${scope.prefix}${key}: expected array`);
    return [...fallback];
  }
  const items: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && (allowed as readonly string[]).includes(item)) {
      items.push(item as T);
    } else {
      scope.problems.push(
        `${scope.prefix}${key}: unknown value ${JSON.stringify(item)}; allowed: ${allowed.join(", ")}`,
      );
    }
  }
  return items;
}

function promptOverrides(scope: Scope): PromptOverrides {
  const prompts = object(scope, "prompts", PROMPT_KEYS);
  const overrides: PromptOverrides = {};
  for (const key of ["description", "snippet"] as const) {
    const line = optionalString(prompts, key);
    if (line !== undefined) {
      overrides[key] = line;
    }
  }
  const guidelines = stringArray(prompts, "guidelines");
  if (guidelines !== undefined) {
    overrides.guidelines = guidelines;
  }
  return overrides;
}

function parse(raw: Raw, file: string): Config {
  const problems: string[] = [];
  const top: Scope = { raw, prefix: "", problems };
  unknownKeys(top, CONFIG_KEYS);
  const bridge = object(top, "bridge", BRIDGE_KEYS);

  const config: Config = {
    enabled: boolean(top, "enabled", true),
    toolName: toolName(top),
    maxConcurrent: integer(top, "maxConcurrent", 16, 1, Number.POSITIVE_INFINITY),
    maxResultChars: integer(top, "maxResultChars", 16384, 1024, 1048576),
    aggregateWindowMs: integer(top, "aggregateWindowMs", 500, 0, 10000),
    closeChildrenOn: enumList(top, "closeChildrenOn", SHUTDOWN_REASONS, []),
    inboxPollMs: integer(top, "inboxPollMs", 250, 50, 5000),
    prompts: promptOverrides(top),
    bridge: {
      enabled: boolean(bridge, "enabled", true),
      blockedOn: enumList(bridge, "blockedOn", BLOCKED_KINDS, BLOCKED_KINDS),
    },
  };

  if (problems.length > 0) {
    throw new Error(`invalid config ${file}: ${problems.join("; ")}`);
  }
  return config;
}

function readRaw(file: string): Raw {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`invalid config ${file}: not valid JSON`);
  }
  if (!isRaw(parsed)) {
    throw new Error(`invalid config ${file}: expected a JSON object`);
  }
  return parsed;
}

export function dataDir(agentDir: string): string {
  return join(agentDir, "pi-herdr-subagents-lite");
}

function configPath(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  const agentDir = override ? override : join(homedir(), ".pi", "agent");
  return join(dataDir(agentDir), "config.json");
}

export function loadConfig(): Config {
  const file = configPath();
  return parse(readRaw(file), file);
}
