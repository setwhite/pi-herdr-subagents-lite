import type { RunQuestion, RunResult } from "../run/index.ts";

export interface ResultMessage {
  customType: string;
  content: string;
  display: boolean;
}

interface MessageSink {
  sendMessage(message: ResultMessage, options?: { triggerTurn?: boolean }): void;
}

function resultText(result: RunResult): string {
  if (result.state === "unknown") {
    return `[subagent ${result.name}] unknown (${result.reason})\n\nSession: ${result.sessionFile}`;
  }
  return `[subagent ${result.name}] done\n\n${result.text}`;
}

const QUESTION_FOOTER = [
  "The human answers it in the child's pane. A follow-up sent with send is",
  "queued until the dialog closes.",
].join("\n");

export function sendQuestion(sink: MessageSink, question: RunQuestion): void {
  const content = `[subagent ${question.name}] blocked (question)\n\n${question.text.trim()}\n\n${QUESTION_FOOTER}`;
  sink.sendMessage({ customType: "subagent_question", content, display: true }, { triggerTurn: true });
}

export function sendResult(sink: MessageSink, result: RunResult): void {
  sink.sendMessage(
    { customType: "subagent_result", content: resultText(result), display: true },
    { triggerTurn: true },
  );
}
