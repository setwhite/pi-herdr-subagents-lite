import type { RunResult } from "../run/index.ts";

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

export function sendResult(sink: MessageSink, result: RunResult): void {
  sink.sendMessage(
    { customType: "subagent_result", content: resultText(result), display: true },
    { triggerTurn: true },
  );
}
