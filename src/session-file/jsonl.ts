export interface ToolCall {
  name: string;
  arguments: unknown;
}

export interface SessionSnapshot {
  text: string | null;
  pendingToolCall: boolean;
  toolCall?: ToolCall;
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

function lastToolCall(content: unknown): ToolCall | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (let index = content.length - 1; index >= 0; index--) {
    const block = content[index];
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const candidate = block as { type?: unknown; name?: unknown; arguments?: unknown };
    if (candidate.type === "toolCall" && typeof candidate.name === "string") {
      return { name: candidate.name, arguments: candidate.arguments };
    }
  }
  return undefined;
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
    const toolCall = lastToolCall(entry.message?.content);
    return toolCall === undefined
      ? { text: textOf(entry), pendingToolCall: false }
      : { text: textOf(entry), pendingToolCall: true, toolCall };
  }
  return { text: null, pendingToolCall: false };
}
