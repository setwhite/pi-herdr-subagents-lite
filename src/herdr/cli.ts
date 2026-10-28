import { execFile } from "node:child_process";

export class HerdrHostError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HerdrHostError";
    this.code = code;
  }
}

interface HerdrErrorBody {
  code?: string;
  message?: string;
}

const HOST_ERROR_CODES: Record<string, string> = {
  agent_name_taken: "name_taken",
};

function hostError(code: string, message: string): HerdrHostError {
  return new HerdrHostError(HOST_ERROR_CODES[code] ?? code, message);
}

function parseHerdrError(text: string): HerdrErrorBody | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { error?: HerdrErrorBody };
    return parsed.error?.code ? parsed.error : null;
  } catch {
    return null;
  }
}

export function execHerdrText(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "herdr",
      args,
      { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const parsed = parseHerdrError(stderr) ?? parseHerdrError(stdout);
        reject(
          parsed
            ? hostError(parsed.code ?? "herdr_failed", parsed.message ?? parsed.code ?? "herdr failed")
            : new HerdrHostError("herdr_failed", error.message),
        );
      },
    );
  });
}

export type ExecHerdr = <T>(args: string[]) => Promise<T>;
export type ExecHerdrText = (args: string[]) => Promise<string>;

export async function execHerdrJson<T>(args: string[]): Promise<T> {
  const stdout = await execHerdrText(args);
  let parsed: { result?: T; error?: HerdrErrorBody };
  try {
    parsed = JSON.parse(stdout) as { result?: T; error?: HerdrErrorBody };
  } catch {
    throw new HerdrHostError("herdr_protocol", `herdr ${args.join(" ")}: invalid JSON`);
  }
  if (parsed.error?.code) {
    throw hostError(parsed.error.code, parsed.error.message ?? parsed.error.code);
  }
  if (parsed.result === undefined) {
    throw new HerdrHostError("herdr_protocol", `herdr ${args.join(" ")}: no result`);
  }
  return parsed.result;
}
