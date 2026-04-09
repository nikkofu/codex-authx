export interface ReleaseTarget {
  id: "macos-x64" | "macos-arm64";
  pkgTarget: "node18-macos-x64" | "node18-macos-arm64";
}

export const releaseTargets: ReleaseTarget[] = [
  {
    id: "macos-x64",
    pkgTarget: "node18-macos-x64"
  },
  {
    id: "macos-arm64",
    pkgTarget: "node18-macos-arm64"
  }
];

export function binaryFileNameForTarget(_target: ReleaseTarget): string {
  return "codex-authx";
}

export function archiveFileNameForTarget(target: ReleaseTarget): string {
  return `codex-authx-${target.id}.tar.gz`;
}

export function buildOutputPathForTarget(baseDir: string, target: ReleaseTarget): string {
  return `${baseDir}/${target.id}/${binaryFileNameForTarget(target)}`;
}

export function supportedReleaseTargetsForHost(host: {
  platform: NodeJS.Platform;
  arch: string;
}): ReleaseTarget[] {
  if (host.platform !== "darwin") {
    return [];
  }

  if (host.arch === "x64") {
    return releaseTargets.filter((target) => target.id === "macos-x64");
  }

  if (host.arch === "arm64") {
    return releaseTargets.filter((target) => target.id === "macos-arm64");
  }

  return [];
}
