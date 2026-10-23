import { readFileSync } from "node:fs";

export type SessionReader = (path: string) => string | null;

interface SessionEntry {
  type?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
  };
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

function textOf(entry: SessionEntry): string | null {
  const content = entry.message?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .filter(isTextBlock)
    .map((block) => block.text)
    .filter((block) => block.trim() !== "")
    .join("\n")
    .trim();
  return text === "" ? null : text;
}

export const readLastAssistantText: SessionReader = (path) => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const entry = parsed as SessionEntry;
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      continue;
    }
    return textOf(entry);
  }
  return null;
};
