import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EXAMPLE_PROFILE, loadProfiles, type Profile, seedExampleProfile } from "../src/profile/index.ts";

let agentDir = "";
let projectDir = "";

function profilesDir(): string {
  return join(agentDir, "pi-herdr-subagents-lite", "profiles");
}

function catalog(options: { trusted?: boolean } = {}) {
  return loadProfiles({ cwd: projectDir, trusted: options.trusted ?? false });
}

function writeProjectProfile(fileName: string, content: string): string {
  const file = join(projectDir, ".pi", "pi-herdr-subagents-lite", "profiles", fileName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
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
  const name = /^name:/m.test(frontmatter) ? "" : "name: explore\n";
  writeProfile("explore.md", `---\n${name}${frontmatter}\n---\n\n${body}`);
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

it("requires a name", () => {
  writeProfile("plain.md", "Just text.\n");

  expect(catalog()).toEqual({
    profiles: [],
    problems: [
      {
        name: "plain",
        file: join(profilesDir(), "plain.md"),
        field: "name",
        reason: "required",
      },
    ],
  });
});

it("uses the frontmatter name as the key, not the file name", () => {
  const profile = profileFrom("name: reviewer\ndescription: Review code");

  expect(profile.name).toBe("reviewer");
});

it("trims the name and rejects a blank one", () => {
  expect(profileFrom("name: '  reviewer  '\ndescription: x").name).toBe("reviewer");
  rmSync(profilesDir(), { recursive: true, force: true });

  const file = writeProfile("blank.md", "---\nname: '   '\n---\n\nbody\n");

  expect(catalog()).toEqual({
    profiles: [],
    problems: [{ name: "blank", file, field: "name", reason: "expected a non-empty name" }],
  });
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
    'model: opencode-go/x\nthinking: high\ntools: "read,bash"\nsystem-prompt: replace\nauto-exit: true\ndisable-model-invocation: true',
  );

  expect(profile.model).toBe("opencode-go/x");
  expect(profile.thinking).toBe("high");
  expect(profile.tools).toBe("read,bash");
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
    const file = writeProfile("explore.md", `---\nname: explore\ntools: ${value}\n---\n\nbody\n`);

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
    const file = writeProfile("explore.md", `---\nname: explore\nskills: ${value}\n---\n\nbody\n`);

    expect(catalog().problems).toEqual([
      { name: "explore", file, field: "skills", reason: "expected names without +/- prefixes" },
    ]);
  }
});

it("ignores unknown fields", () => {
  writeProfile("explore.md", "---\nname: explore\nsession-mode: yolo\ndenyWrites: true\n---\n\nbody\n");

  const { profiles, problems } = catalog();

  expect(problems).toEqual([]);
  expect(profiles.map((profile) => profile.name)).toEqual(["explore"]);
});

it("reports a bad thinking level", () => {
  const file = writeProfile("explore.md", "---\nname: explore\nthinking: sometimes\n---\n\nbody\n");

  const { profiles, problems } = catalog();

  expect(profiles).toEqual([]);
  expect(problems).toEqual([
    { name: "explore", file, field: "thinking", reason: "expected one of off, minimal, low, medium, high, xhigh, max" },
  ]);
});

it("reports a bad field type", () => {
  const file = writeProfile("explore.md", "---\nname: explore\nmodel: [a]\nauto-exit: yes please\n---\n\nbody\n");

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
  expect(problems[0]?.name).toBe("broken");
});

it("returns no profiles when the agents directory is missing", () => {
  expect(catalog()).toEqual({ profiles: [], problems: [] });
});

it("reads project profiles when trusted", () => {
  writeProfile("global.md", "---\nname: global\n---\n\nGlobal body.\n");
  writeProjectProfile("project.md", "---\nname: project\n---\n\nProject body.\n");

  expect(catalog().profiles.map((profile) => profile.name)).toEqual(["global"]);
  expect(catalog({ trusted: true }).profiles.map((profile) => profile.name)).toEqual(["global", "project"]);
});

it("lets project profiles override global ones by name", () => {
  writeProfile("worker.md", "---\nname: worker\ndescription: Global worker\n---\n\nGlobal body.\n");
  writeProjectProfile("local.md", "---\nname: worker\ndescription: Project worker\n---\n\nProject body.\n");

  const { profiles } = catalog({ trusted: true });

  expect(profiles).toHaveLength(1);
  expect(profiles[0]?.name).toBe("worker");
  expect(profiles[0]?.description).toBe("Project worker");
  expect(profiles[0]?.body).toBe("Project body.");
});

it("lets a project profile replace a broken global one", () => {
  writeProfile("worker.md", "---\nname: worker\nthinking: sometimes\n---\n\nGlobal body.\n");
  writeProjectProfile("local.md", "---\nname: worker\nthinking: high\n---\n\nProject body.\n");

  expect(catalog({ trusted: true })).toMatchObject({ profiles: [{ name: "worker", thinking: "high" }], problems: [] });
});

it("rejects duplicate names in the same layer", () => {
  const first = writeProfile("first.md", "---\nname: worker\ndescription: First\n---\n\nFirst body.\n");
  const second = writeProfile("second.md", "---\nname: worker\ndescription: Second\n---\n\nSecond body.\n");

  const { profiles, problems } = catalog();

  expect(profiles).toEqual([]);
  expect(problems).toEqual([
    {
      name: "worker",
      file: first,
      field: "name",
      reason: `duplicate profile name; also in ${second}`,
    },
    {
      name: "worker",
      file: second,
      field: "name",
      reason: `duplicate profile name; also in ${first}`,
    },
  ]);
});

it("lets a broken project layer shadow a valid global profile", () => {
  writeProfile("worker.md", "---\nname: worker\ndescription: Global\n---\n\nGlobal body.\n");
  writeProjectProfile("first.md", "---\nname: worker\n---\n\nFirst body.\n");
  writeProjectProfile("second.md", "---\nname: worker\n---\n\nSecond body.\n");

  const { profiles, problems } = catalog({ trusted: true });

  expect(profiles).toEqual([]);
  expect(problems).toHaveLength(2);
  expect(problems.every((problem) => problem.name === "worker" && problem.field === "name")).toBe(true);
});

it("writes the example profile only when it is missing", () => {
  seedExampleProfile(profilesDir());
  const file = join(profilesDir(), "examples", "domain.md");

  expect(readFileSync(file, "utf8")).toBe(EXAMPLE_PROFILE);

  writeFileSync(file, "edited\n");
  seedExampleProfile(profilesDir());

  expect(readFileSync(file, "utf8")).toBe("edited\n");
});

it("keeps examples out of the loaded profiles", () => {
  seedExampleProfile(profilesDir());

  expect(catalog()).toEqual({ profiles: [], problems: [] });
});

it("loads the example once it is copied a level up", () => {
  seedExampleProfile(profilesDir());
  copyFileSync(join(profilesDir(), "examples", "domain.md"), join(profilesDir(), "domain.md"));

  expect(catalog()).toEqual({
    profiles: [expect.objectContaining({ name: "domain", autoExit: true, disableModelInvocation: true })],
    problems: [],
  });
});

it("keeps the example file name and name in sync", () => {
  expect(EXAMPLE_PROFILE).toContain("name: domain\n");
  expect(EXAMPLE_PROFILE).toContain("profiles/domain.md");
});

it("sorts profiles by name", () => {
  writeProfile("z-file.md", "---\nname: zeta\n---\n\nZeta body.\n");
  writeProfile("a-file.md", "---\nname: alpha\n---\n\nAlpha body.\n");
  writeProfile("notes.txt", "not a profile");

  expect(catalog().profiles.map((profile) => profile.name)).toEqual(["alpha", "zeta"]);
});
