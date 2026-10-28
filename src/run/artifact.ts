import { writeFileSync } from "node:fs";

function artifactPath(sessionFile: string, seq: number): string {
  return `${sessionFile}.result-${seq}.md`;
}

export function writeArtifact(sessionFile: string, seq: number, text: string): string {
  const path = artifactPath(sessionFile, seq);
  writeFileSync(path, text);
  return path;
}
