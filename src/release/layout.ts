import type { ReleaseTarget } from "./targets.js";

export function releaseDirectoryNameForTarget(target: ReleaseTarget): string {
  return `codex-authx-${target.id}`;
}

export function releaseArchiveEntries(): string[] {
  return ["codex-authx", "README.md", "LICENSE"];
}
