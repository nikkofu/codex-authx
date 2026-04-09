#!/usr/bin/env node

import os from "node:os";

import {
  initializeAuthx,
  listProfiles,
  saveProfile,
  switchProfile
} from "../core/authx.js";

function resolveHomeDir(): string {
  return process.env.AUTHX_HOME_DIR || os.homedir();
}

function renderHelp(seedMessage?: string): string {
  const lines = [
    "codex-authx v0.1.2"
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
    "",
    "Notes:",
    "  Any command initializes ~/.codex/authx/ on first run.",
    "  If ~/.codex/auth.json exists, default.json is seeded automatically."
  );

  return lines.join("\n");
}

export async function runCli(args: string[]): Promise<number> {
  const homeDir = resolveHomeDir();
  const [command, ...rest] = args;

  try {
    const initialization = await initializeAuthx({ homeDir });

    if (!command || command === "help") {
      console.log(
        renderHelp(initialization.seededDefault ? "initialized default profile" : undefined)
      );
      return 0;
    }

    if (command === "list") {
      const profiles = await listProfiles({ homeDir });
      if (profiles.length > 0) {
        console.log(profiles.join("\n"));
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
