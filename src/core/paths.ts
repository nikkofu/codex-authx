import path from "node:path";

export interface AuthxPaths {
  authxDir: string;
  authFile: string;
  defaultProfile: string;
  lastActiveProfile: string;
}

export function resolveAuthxPaths(homeDir: string): AuthxPaths {
  const codexDir = path.join(homeDir, ".codex");
  const authxDir = path.join(codexDir, "authx");

  return {
    authxDir,
    authFile: path.join(codexDir, "auth.json"),
    defaultProfile: path.join(authxDir, "default.json"),
    lastActiveProfile: path.join(authxDir, "last-active.json")
  };
}

export function resolveProfilePath(homeDir: string, profileName: string): string {
  return path.join(resolveAuthxPaths(homeDir).authxDir, `${profileName}.json`);
}
