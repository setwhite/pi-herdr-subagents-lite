import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readLastAssistant } from "../src/session-file/index.ts";

const tempDirs = new Set<string>();

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-herdr-session-"));
  tempDirs.add(dir);
  return join(dir, "session.jsonl");
}

function message(role: string, content: unknown[]): string {
  return JSON.stringify({ type: "message", message: { role, content } });
}

interface SessionCase {
  name: string;
  lines?: string[];
  expected: { text: string | null; pendingToolCall: boolean; empty: boolean };
}

const cases: SessionCase[] = [
  {
    name: "returns the last assistant text",
    lines: [
      message("assistant", [{ type: "text", text: "first" }]),
      message("assistant", [{ type: "text", text: "second" }]),
    ],
    expected: { text: "second", pendingToolCall: false, empty: false },
  },
  {
    name: "joins multiple text blocks with newlines",
    lines: [
      message("assistant", [
        { type: "text", text: "First block." },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Second block." },
      ]),
    ],
    expected: { text: "First block.\nSecond block.", pendingToolCall: false, empty: false },
  },
  {
    name: "skips malformed lines",
    lines: [message("assistant", [{ type: "text", text: "kept" }]), "{not json"],
    expected: { text: "kept", pendingToolCall: false, empty: false },
  },
  {
    name: "returns null when the last assistant has no text",
    lines: [
      message("assistant", [{ type: "text", text: "earlier" }]),
      message("assistant", [{ type: "thinking", thinking: "only thinking" }]),
    ],
    expected: { text: null, pendingToolCall: false, empty: false },
  },
  {
    name: "returns null when the file is missing",
    expected: { text: null, pendingToolCall: false, empty: true },
  },
  {
    name: "is empty when no assistant message is written yet",
    lines: [message("user", [{ type: "text", text: "# Task" }])],
    expected: { text: null, pendingToolCall: false, empty: true },
  },
  {
    name: "marks a trailing tool call as pending",
    lines: [
      message("assistant", [
        { type: "text", text: "Need a decision." },
        { type: "thinking", thinking: "waiting" },
        { type: "toolCall", id: "call-1", name: "ask_user_question", arguments: {} },
      ]),
    ],
    expected: {
      text: "Need a decision.",
      pendingToolCall: true,
      empty: false,
    },
  },
  {
    name: "marks a tool-only assistant message as pending",
    lines: [message("assistant", [{ type: "toolCall", id: "call-1", name: "ask_user_question", arguments: {} }])],
    expected: {
      text: null,
      pendingToolCall: true,
      empty: false,
    },
  },
];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

it.each(cases)("$name", ({ lines, expected }) => {
  const file = tempFile();
  if (lines) {
    writeFileSync(file, `${lines.join("\n")}\n`);
  }

  expect(readLastAssistant(file)).toEqual(expected);
});
