import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readLastAssistantText } from "../src/session/index.ts";

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
  expected: string | null;
}

const cases: SessionCase[] = [
  {
    name: "returns the last assistant text",
    lines: [
      message("assistant", [{ type: "text", text: "first" }]),
      message("assistant", [{ type: "text", text: "second" }]),
    ],
    expected: "second",
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
    expected: "First block.\nSecond block.",
  },
  {
    name: "skips malformed lines",
    lines: [message("assistant", [{ type: "text", text: "kept" }]), "{not json"],
    expected: "kept",
  },
  {
    name: "returns null when the last assistant has no text",
    lines: [
      message("assistant", [{ type: "text", text: "earlier" }]),
      message("assistant", [{ type: "thinking", thinking: "only thinking" }]),
    ],
    expected: null,
  },
  {
    name: "returns null when the file is missing",
    expected: null,
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

  expect(readLastAssistantText(file)).toBe(expected);
});
