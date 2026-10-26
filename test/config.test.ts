import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/index.ts";

const specDefaults = {
  enabled: true,
  toolName: "subagent",
  maxConcurrent: 16,
  maxResultChars: 16384,
  aggregateWindowMs: 500,
  closeChildrenOn: [],
  inboxPollMs: 250,
  prompts: {},
  bridge: { enabled: true, blockedOn: ["custom", "select", "confirm", "input", "editor"] },
};

function withAgentDir<T>(file: string | undefined, read: () => T): T {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-herdr-config-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  if (file !== undefined) {
    const target = join(agentDir, "pi-herdr-subagents-lite", "config.json");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file);
  }
  try {
    return read();
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function readConfig(value?: unknown) {
  return withAgentDir(value === undefined ? undefined : JSON.stringify(value), loadConfig);
}

it("uses the spec defaults when the config file is missing", () => {
  expect(readConfig()).toEqual(specDefaults);
});

it("keeps the defaults for keys the file omits", () => {
  expect(readConfig({ maxConcurrent: 2 })).toEqual({ ...specDefaults, maxConcurrent: 2 });
});

it.each([
  [{ maxConcurrent: 0 }, { maxConcurrent: 1 }],
  [{ maxConcurrent: 1000 }, { maxConcurrent: 1000 }],
  [{ maxResultChars: 1 }, { maxResultChars: 1024 }],
  [{ maxResultChars: 9999999 }, { maxResultChars: 1048576 }],
  [{ aggregateWindowMs: 99999 }, { aggregateWindowMs: 10000 }],
  [{ aggregateWindowMs: -1 }, { aggregateWindowMs: 0 }],
  [{ inboxPollMs: 1 }, { inboxPollMs: 50 }],
  [{ inboxPollMs: 99999 }, { inboxPollMs: 5000 }],
])("clamps %o", (patch, expected) => {
  expect(readConfig(patch)).toMatchObject(expected);
});

it.each([
  [{ nope: 1 }, /nope/],
  [{ enabled: "yes" }, /enabled/],
  [{ maxConcurrent: "3" }, /maxConcurrent/],
  [{ maxConcurrent: 2.5 }, /maxConcurrent/],
  [{ maxResultChars: "16384" }, /maxResultChars/],
  [{ closeChildrenOn: ["sometimes"] }, /closeChildrenOn.*sometimes/],
  [{ toolName: "Helper" }, /toolName/],
  [{ toolName: "1x" }, /toolName/],
  [{ prompts: { nope: "x" } }, /prompts\.nope/],
  [{ prompts: { guidelines: "Use subagent" } }, /prompts\.guidelines/],
  [{ bridge: { extra: true } }, /bridge\.extra/],
  [{ bridge: { blockedOn: ["nope"] } }, /blockedOn.*nope/],
])("rejects invalid config %o", (value, message) => {
  expect(() => readConfig(value)).toThrow(message);
});

it("rejects a config file that is not valid JSON", () => {
  expect(() => withAgentDir("{", loadConfig)).toThrow(/not valid JSON/);
});

it("rejects a config file that is not a JSON object", () => {
  expect(() => withAgentDir("[]", loadConfig)).toThrow(/expected a JSON object/);
});

it("ignores an empty agent dir override", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-herdr-home-"));
  const file = join(home, ".pi", "agent", "pi-herdr-subagents-lite", "config.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ maxConcurrent: 3 }));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", "");
  try {
    expect(loadConfig().maxConcurrent).toBe(3);
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
