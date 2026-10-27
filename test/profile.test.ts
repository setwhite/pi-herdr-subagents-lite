import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadProfiles, type Profile } from "../src/profile/index.ts";

let agentDir = "";
let projectDir = "";

function profilesDir(): string {
  return join(agentDir, "pi-herdr-subagents-lite", "profiles");
}

function catalog(options: { trusted?: boolean } = {}) {
  return loadProfiles({ cwd: projectDir, trusted: options.trusted ?? false });
}

function writeProjectProfile(fileName: string, content: string) {
  const file = join(projectDir, ".pi", "pi-herdr-subagents-lite", "profiles", fileName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function writeProfile(fileName: string, content: string): string {
  const file = join(profilesDir(), fileName);
  mkdirSync(profilesDir(), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function onlyProfile(): Profile {
  const { profiles } = catalog();
  const profile = profiles[0];
  if (profiles.length !== 1 || !profile) {
    throw new Error(`expected one profile, got ${profiles.length}`);
  }
  return profile;
}

function profileFrom(frontmatter: string, body = "Body.\n"): Profile {
  writeProfile("explore.md", `---\n${frontmatter}\n---\n\n${body}`);
  return onlyProfile();
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-herdr-profiles-"));
  projectDir = mkdtempSync(join(tmpdir(), "pi-herdr-project-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

it("splits frontmatter from the body", () => {
  const profile = profileFrom("description: Explore the repo", "# Explore\n\nFind things.\n");

  expect(profile.name).toBe("explore");
  expect(profile.description).toBe("Explore the repo");
  expect(profile.body).toBe("# Explore\n\nFind things.");
});

it("keeps the whole file as body without frontmatter", () => {
  writeProfile("plain.md", "Just text.\n");

  const profile = onlyProfile();

  expect(profile.name).toBe("plain");
  expect(profile.body).toBe("Just text.\n");
  expect(profile.description).toBe("");
});

it("falls back to the file name as display name", () => {
  expect(profileFrom("description: x").displayName).toBe("explore");

  expect(profileFrom("name: Explorer\ndescription: x").displayName).toBe("Explorer");
});

it("parses skills as a list", () => {
  expect(profileFrom("skills: a").skills).toEqual(["a"]);
  expect(profileFrom("skills: [a, b]").skills).toEqual(["a", "b"]);
  expect(profileFrom('skills: ""').skills).toEqual([]);
  expect(profileFrom("skills: []").skills).toEqual([]);
  expect(profileFrom("description: none").skills).toBeUndefined();
});

it("reads the remaining profile fields", () => {
  const profile = profileFrom(
    'model: opencode-go/x\nthinking: high\ntools: "read,bash"\ncwd: sub\nsystem-prompt: replace\nauto-exit: true\ndisable-model-invocation: true',
  );

  expect(profile.model).toBe("opencode-go/x");
  expect(profile.thinking).toBe("high");
  expect(profile.tools).toBe("read,bash");
  expect(profile.cwd).toBe("sub");
  expect(profile.systemPrompt).toBe("replace");
  expect(profile.autoExit).toBe(true);
  expect(profile.disableModelInvocation).toBe(true);
});

it("fills defaults", () => {
  const profile = profileFrom("description: x");

  expect(profile.model).toBeUndefined();
  expect(profile.thinking).toBeUndefined();
  expect(profile.tools).toBeUndefined();
  expect(profile.skills).toBeUndefined();
  expect(profile.cwd).toBeUndefined();
  expect(profile.systemPrompt).toBe("append");
  expect(profile.autoExit).toBe(false);
  expect(profile.disableModelInvocation).toBe(false);
});

it("accepts signed tool lists", () => {
  expect(profileFrom("tools: +read,-bash").tools).toBe("+read,-bash");
  expect(profileFrom('tools: ""').tools).toBe("");
});

it("rejects malformed tool lists", () => {
  for (const value of ["read,+bash", "read,,bash", "+"]) {
    const file = writeProfile("explore.md", `---\ntools: ${value}\n---\n\nbody\n`);

    expect(catalog().problems).toEqual([
      {
        name: "explore",
        file,
        field: "tools",
        reason: "expected names, or +name/-name entries, not both",
      },
    ]);
  }
});

it("rejects skills that are not names", () => {
  for (const value of ['["a", ""]', '["+a"]']) {
    const file = writeProfile("explore.md", `---\nskills: ${value}\n---\n\nbody\n`);

    expect(catalog().problems).toEqual([
      { name: "explore", file, field: "skills", reason: "expected names without +/- prefixes" },
    ]);
  }
});

it("ignores unknown fields", () => {
  writeProfile("explore.md", "---\nsession-mode: yolo\ndenyWrites: true\n---\n\nbody\n");

  const { profiles, problems } = catalog();

  expect(problems).toEqual([]);
  expect(profiles.map((profile) => profile.name)).toEqual(["explore"]);
});

it("reports a bad thinking level", () => {
  const file = writeProfile("explore.md", "---\nthinking: sometimes\n---\n\nbody\n");

  const { profiles, problems } = catalog();

  expect(profiles).toEqual([]);
  expect(problems).toEqual([
    { name: "explore", file, field: "thinking", reason: "expected one of off, minimal, low, medium, high, xhigh, max" },
  ]);
});

it("reports a bad field type", () => {
  const file = writeProfile("explore.md", "---\nmodel: [a]\nauto-exit: yes please\n---\n\nbody\n");

  const { profiles, problems } = catalog();

  expect(profiles).toEqual([]);
  expect(problems).toEqual([
    { name: "explore", file, field: "model", reason: "expected string, got array" },
    { name: "explore", file, field: "auto-exit", reason: "expected boolean, got string" },
  ]);
});

it("reports broken frontmatter", () => {
  const file = writeProfile("broken.md", "---\nthinking: [\n---\n\nbody\n");

  const { problems } = catalog();

  expect(problems.map((problem) => problem.field)).toEqual(["frontmatter"]);
  expect(problems[0]?.file).toBe(file);
});

it("returns no profiles when the agents directory is missing", () => {
  expect(catalog()).toEqual({ profiles: [], problems: [] });
});

it("reads project profiles when trusted", () => {
  writeProfile("global.md", "Global body.\n");
  writeProjectProfile("project.md", "Project body.\n");

  expect(catalog().profiles.map((profile) => profile.name)).toEqual(["global"]);
  expect(catalog({ trusted: true }).profiles.map((profile) => profile.name)).toEqual(["global", "project"]);
});

it("lets project profiles override global ones", () => {
  writeProfile("worker.md", "---\ndescription: Global worker\n---\n\nGlobal body.\n");
  writeProjectProfile("worker.md", "---\ndescription: Project worker\n---\n\nProject body.\n");

  const { profiles } = catalog({ trusted: true });

  expect(profiles).toHaveLength(1);
  expect(profiles[0]?.description).toBe("Project worker");
  expect(profiles[0]?.body).toBe("Project body.");
});

it("lets a project profile replace a broken global one", () => {
  writeProfile("worker.md", "---\nthinking: sometimes\n---\n\nGlobal body.\n");
  writeProjectProfile("worker.md", "---\nthinking: high\n---\n\nProject body.\n");

  expect(catalog({ trusted: true })).toMatchObject({ profiles: [{ name: "worker", thinking: "high" }], problems: [] });
});

it("lists profiles by file name", () => {
  writeProfile("zeta.md", "Zeta body.\n");
  writeProfile("alpha.md", "Alpha body.\n");
  writeProfile("notes.txt", "not a profile");

  expect(catalog().profiles.map((profile) => profile.name)).toEqual(["alpha", "zeta"]);
});
