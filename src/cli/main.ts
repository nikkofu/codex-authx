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

export async function runCli(args: string[]): Promise<number> {
  const homeDir = resolveHomeDir();
  const [command, ...rest] = args;

  try {
    if (!command) {
      const result = await initializeAuthx({ homeDir });
      console.log(`authx v0.1.0`);
      console.log(result.seededDefault ? "initialized default profile" : "authx ready");
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

    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(message);
    return 1;
  }
}

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
