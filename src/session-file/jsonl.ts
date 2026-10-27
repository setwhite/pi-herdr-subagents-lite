export interface SessionSnapshot {
  text: string | null;
  pendingToolCall: boolean;
}

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

function hasToolCall(entry: SessionEntry): boolean {
  const content = entry.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "toolCall",
  );
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

export function parseLastAssistant(raw: string): SessionSnapshot {
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
    return { text: textOf(entry), pendingToolCall: hasToolCall(entry) };
  }
  return { text: null, pendingToolCall: false };
}
