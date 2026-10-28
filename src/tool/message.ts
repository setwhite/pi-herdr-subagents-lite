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
  const artifact = result.artifact ? `\n\nFull result: ${result.artifact}` : "";
  const warning = result.warning ? `\n\n${result.warning}` : "";
  return `[subagent ${result.name}] done\n\n${result.text}${artifact}${warning}`;
}

const QUESTION_FOOTER = [
  "The human answers it in the child's pane. A follow-up sent with send is",
  "queued until the dialog closes.",
].join("\n");

export function sendQuestion(sink: MessageSink, question: RunQuestion): void {
  const content = `[subagent ${question.name}] blocked (question)\n\n${question.text.trim()}\n\n${QUESTION_FOOTER}`;
  sink.sendMessage({ customType: "subagent_question", content, display: true }, { triggerTurn: true });
}

export function sendResults(sink: MessageSink, results: RunResult[]): void {
  const content = results.map(resultText).join("\n\n");
  sink.sendMessage({ customType: "subagent_result", content, display: true }, { triggerTurn: true });
}
