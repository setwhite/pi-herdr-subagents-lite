import type { ToolCall } from "../session-file/index.ts";
import type { RunRecord, RunState } from "./state.ts";

export interface RunQuestion {
  name: string;
  text: string;
}

export type QuestionHandler = (question: RunQuestion) => void | Promise<void>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function line(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionLines(options: unknown): string[] {
  if (!Array.isArray(options)) {
    return [];
  }
  const lines: string[] = [];
  for (const entry of options) {
    const label = line(record(entry).label);
    if (label === undefined) {
      continue;
    }
    const description = line(record(entry).description);
    lines.push(description === undefined ? `- ${label}` : `- ${label} — ${description}`);
  }
  return lines;
}

function groupLines(questions: unknown): string[] {
  if (!Array.isArray(questions)) {
    return [];
  }
  const lines: string[] = [];
  for (const entry of questions) {
    const group = record(entry);
    const question = line(group.question);
    if (question === undefined) {
      continue;
    }
    const header = line(group.header);
    lines.push(header === undefined ? question : `${header}: ${question}`, ...optionLines(group.options), "");
  }
  return lines;
}

function plainLine(args: unknown): string | undefined {
  const values = record(args);
  for (const key of ["question", "title", "message", "prompt", "text"]) {
    const found = line(values[key]);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function questionText(call: ToolCall | undefined): string {
  if (call === undefined) {
    return "";
  }
  const lines = groupLines(record(call.arguments).questions);
  if (lines.length > 0) {
    return lines.join("\n").trim();
  }
  return plainLine(call.arguments) ?? "";
}

export async function askBlocked(state: RunState, run: RunRecord): Promise<void> {
  if (run.blocked) {
    return;
  }
  run.blocked = true;
  try {
    await state.questionHandler?.({
      name: run.name,
      text: questionText(state.readLastAssistant(run.sessionFile).toolCall),
    });
    run.pollFailures = 0;
  } catch (error) {
    state.onDeliveryError(error);
  }
}
