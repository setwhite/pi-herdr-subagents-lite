import { beforeEach, expect, it } from "vitest";
import { createExtension, type ExtensionRegistrar, type SubagentTool } from "../src/extension/index.ts";
import type { HerdrHost } from "../src/herdr/index.ts";

function fakePi() {
  const tools: SubagentTool[] = [];
  const pi: ExtensionRegistrar = {
    registerTool(tool) {
      tools.push(tool);
    },
  };
  return { pi, tools };
}

function countingHost() {
  const calls: string[] = [];
  const host: HerdrHost = {
    async createTab() {
      calls.push("createTab");
      return { tabId: "w1:t1", paneId: "w1:p1" };
    },
    async startAgent() {
      calls.push("startAgent");
    },
    async getAgent() {
      calls.push("getAgent");
      return null;
    },
    async closeTabIfOnlyPane() {
      calls.push("closeTabIfOnlyPane");
      return "closed";
    },
  };
  return { calls, host };
}

function loadTool(host: HerdrHost) {
  const { pi, tools } = fakePi();
  createExtension({ host })(pi);
  const tool = tools[0];
  if (tools.length !== 1 || !tool) {
    throw new Error(`expected one registered tool, got ${tools.length}`);
  }
  return tool;
}

beforeEach(() => {
  delete process.env.HERDR_ENV;
});

it("registers the subagent schema", () => {
  const tool = loadTool(countingHost().host);

  expect(tool.name).toBe("subagent");
  expect(tool.label).toBe("Subagent");

  const schema = tool.parameters as unknown as {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.type).toBe("object");
  expect(Object.keys(schema.properties)).toEqual(["action", "task"]);
  expect(schema.properties.action).toMatchObject({ const: "run" });
  expect(schema.properties.task).toMatchObject({ type: "string", minLength: 1 });
  expect(schema.required).toEqual(["action", "task"]);
  expect(schema.additionalProperties).toBe(false);
});

it("rejects outside herdr", async () => {
  const { calls, host } = countingHost();
  const tool = loadTool(host);

  const result = await tool.execute(
    "call-1",
    { action: "run", task: "inspect the repo" },
    undefined,
    undefined,
    {} as never,
  );

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    {
      type: "text",
      text: "not_in_herdr: subagent requires running pi inside a herdr pane; there is no fallback.",
    },
  ]);
  expect(calls).toEqual([]);
});

it("documents the asynchronous prompt contract", () => {
  const tool = loadTool(countingHost().host);
  const description = tool.description.toLowerCase();
  const snippet = (tool.promptSnippet ?? "").toLowerCase();
  const guidelines = (tool.promptGuidelines ?? []).join("\n").toLowerCase();

  expect(description).toContain("background worker");
  expect(description).toContain("asynchronously");
  expect(snippet).toContain("background worker");
  expect(snippet).toContain("asynchronously");
  expect(guidelines).toContain("subagent_result");
});
