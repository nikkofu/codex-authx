#!/usr/bin/env node

import os from "node:os";

import { readStatusSummary } from "../core/status.js";
import {
  initializeAuthx,
  resolveActiveProfile,
  saveProfile,
  switchProfile
} from "../core/authx.js";

function resolveHomeDir(): string {
  return process.env.AUTHX_HOME_DIR || os.homedir();
}

function renderHelp(seedMessage?: string): string {
  const lines = [
    "codex-authx v0.1.3"
  ];

  if (seedMessage) {
    lines.push(seedMessage);
  }

  lines.push(
    "",
    "Usage:",
    "  codex-authx help",
    "  codex-authx list",
    '  codex-authx save "Team A"',
    '  codex-authx switch "Team A"',
    "  codex-authx whoami",
    "  codex-authx usage",
    "",
    "Notes:",
    "  Any command initializes ~/.codex/authx/ on first run.",
    "  If ~/.codex/auth.json exists, default.json is seeded automatically.",
    "  Usage is tracked locally from authx switch snapshots."
  );

  return lines.join("\n");
}

function formatServerSummary(server: {
  status: "available" | "unknown";
  usedPercentLast5Hours?: number;
  usedPercentLast7Days?: number;
  resetsAtLast5Hours?: number;
  resetsAtLast7Days?: number;
}): string {
  if (server.status !== "available") {
    return "server=unknown";
  }

  return (
    `server 5h=${server.usedPercentLast5Hours}% 7d=${server.usedPercentLast7Days}% ` +
    `reset ${formatReset(server.resetsAtLast5Hours)}/${formatReset(server.resetsAtLast7Days)}`
  );
}

function formatProfileStatusLine(profile: {
  profileName: string;
  accountId: string | null;
  isActive: boolean;
  local: {
    tokensLast5Hours: number;
    tokensLast7Days: number;
  };
  server: {
    status: "available" | "unknown";
    usedPercentLast5Hours?: number;
    usedPercentLast7Days?: number;
    resetsAtLast5Hours?: number;
    resetsAtLast7Days?: number;
  };
}): string {
  const marker = profile.isActive ? "*" : "-";
  return (
    `${marker} ${profile.profileName} account_id=${profile.accountId ?? "unknown"} ` +
    `local 5h=${profile.local.tokensLast5Hours} 7d=${profile.local.tokensLast7Days} ` +
    `${formatServerSummary(profile.server)}`
  );
}

function renderDefaultStatus(args: {
  version: string;
  seededDefault: boolean;
  current: {
    profileName: string | null;
    accountId: string | null;
    local: {
      tokensLast5Hours: number;
      tokensLast7Days: number;
    } | null;
    server: {
      status: "available" | "unknown";
      usedPercentLast5Hours?: number;
      usedPercentLast7Days?: number;
      resetsAtLast5Hours?: number;
      resetsAtLast7Days?: number;
    };
  };
}): string {
  const lines = [args.version];

  if (args.seededDefault) {
    lines.push("initialized default profile");
  }

  lines.push(
    `current: ${args.current.profileName ?? "unknown"} account_id=${args.current.accountId ?? "unknown"}`,
    `local 5h=${args.current.local?.tokensLast5Hours ?? 0} 7d=${args.current.local?.tokensLast7Days ?? 0}`,
    formatServerSummary(args.current.server),
    "",
    "Run `codex-authx list` for all profiles or `codex-authx help` for commands."
  );

  return lines.join("\n");
}

function formatReset(unixSeconds?: number): string {
  if (typeof unixSeconds !== "number") {
    return "unknown";
  }

  return new Date(unixSeconds * 1000).toISOString();
}

export async function runCli(args: string[]): Promise<number> {
  const homeDir = resolveHomeDir();
  const [command, ...rest] = args;

  try {
    const initialization = await initializeAuthx({ homeDir });

    if (!command) {
      const status = await readStatusSummary({ homeDir });
      console.log(
        renderDefaultStatus({
          version: "codex-authx v0.1.3",
          seededDefault: initialization.seededDefault,
          current: status.current
        })
      );
      return 0;
    }

    if (command === "help") {
      console.log(renderHelp(initialization.seededDefault ? "initialized default profile" : undefined));
      return 0;
    }

    if (command === "list") {
      const status = await readStatusSummary({ homeDir });
      if (status.profiles.length > 0) {
        console.log(status.profiles.map(formatProfileStatusLine).join("\n"));
      }
      return 0;
    }

    if (command === "save") {
      const name = rest.join(" ");
      const result = await saveProfile({ homeDir, profileName: name });
      console.log(`saved profile: ${result.profileName}`);
      return 0;
    }

    if (command === "switch") {
      const name = rest.join(" ");
      const result = await switchProfile({ homeDir, profileName: name });
      console.log(`switched profile: ${result.profileName}`);
      return 0;
    }

    if (command === "whoami") {
      const active = await resolveActiveProfile({ homeDir });
      console.log(`profile: ${active.profileName ?? "unknown"}`);
      console.log(`account_id: ${active.accountId ?? "unknown"}`);
      return 0;
    }

    if (command === "usage") {
      const status = await readStatusSummary({ homeDir });
      console.log(`current profile: ${status.current.profileName ?? "unknown"}`);
      console.log(`current account_id: ${status.current.accountId ?? "unknown"}`);
      console.log("");

      for (const profile of status.profiles) {
        console.log(formatProfileStatusLine(profile));
      }

      return 0;
    }

    throw new Error(`unknown command: ${command}\nrun 'codex-authx help' for usage`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(message);
    return 1;
  }
}

void runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
