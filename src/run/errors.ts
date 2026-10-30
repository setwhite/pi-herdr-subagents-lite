import { HerdrHostError } from "../herdr/index.ts";

export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export function spawnFailed(error: unknown, paneId: string | undefined, created = true): ToolError {
  const detail = error instanceof Error ? error.message : String(error);
  const createdNote = created && paneId ? `. A pane was created: ${paneId}.` : "";
  const trust =
    error instanceof HerdrHostError && error.code === "agent_not_ready"
      ? " It is probably waiting for a trust dialog. Answer the dialog, then retry."
      : "";
  return new ToolError("spawn_failed", `${detail}${createdNote}${trust}`);
}
