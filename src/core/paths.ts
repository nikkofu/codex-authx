import path from "node:path";

export interface AuthxPaths {
  authxDir: string;
  authFile: string;
  defaultProfile: string;
  lastActiveProfile: string;
  usageLedgerFile: string;
  remoteUsageFile: string;
  serverUsageFile: string;
  stateDbFile: string;
}

export function resolveAuthxPaths(homeDir: string): AuthxPaths {
  const codexDir = path.join(homeDir, ".codex");
  const authxDir = path.join(codexDir, "authx");

  return {
    authxDir,
    authFile: path.join(codexDir, "auth.json"),
    defaultProfile: path.join(authxDir, "default.json"),
    lastActiveProfile: path.join(authxDir, "last-active.json"),
    usageLedgerFile: path.join(authxDir, "usage-ledger.jsonl"),
    remoteUsageFile: path.join(authxDir, "usage-remote.json"),
    serverUsageFile: path.join(authxDir, "usage-server.json"),
    stateDbFile: path.join(codexDir, "state_5.sqlite")
  };
}

export function resolveProfilePath(homeDir: string, profileName: string): string {
  return path.join(resolveAuthxPaths(homeDir).authxDir, `${profileName}.json`);
}
