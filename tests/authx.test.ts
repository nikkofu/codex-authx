import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeAuthx,
  listProfiles,
  saveProfile,
  switchProfile
} from "../src/core/authx.js";
import {
  assertSavableProfileName,
  normalizeProfileName
} from "../src/core/naming.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    })
  );
});

async function makeHomeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "authx-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(args: string[], homeDir: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["bin/authx.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTHX_HOME_DIR: homeDir
    }
  });
}

async function runPlugin(args: string[], homeDir: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["plugins/authx/bin/authx-plugin.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTHX_HOME_DIR: homeDir
    }
  });
}

describe("authx naming", () => {
  it("normalizes profile names into safe slugs", () => {
    expect(normalizeProfileName("Abc Def")).toBe("abc-def");
  });

  it("collapses repeated separators into a single dash", () => {
    expect(normalizeProfileName("  Team___Alpha / Prod  ")).toBe("team-alpha-prod");
  });

  it("rejects names that normalize to empty", () => {
    expect(() => normalizeProfileName("...///___   ")).toThrowError("invalid profile name");
  });

  it("rejects reserved names for save targets", () => {
    expect(() => assertSavableProfileName("last active")).toThrowError(
      "reserved profile name: last-active"
    );
  });
});

describe("authx initialization and listing", () => {
  it("creates the authx directory and seeds default from the active auth file", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    await initializeAuthx({ homeDir });

    const defaultContents = await readFile(
      path.join(codexDir, "authx", "default.json"),
      "utf8"
    );

    expect(defaultContents).toBe('{"token":"active"}');
  });

  it("does not overwrite an existing default profile", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(homeDir, ".codex", "auth.json"), '{"token":"active"}');
    await writeFile(path.join(authxDir, "default.json"), '{"token":"original"}');

    await initializeAuthx({ homeDir });

    const defaultContents = await readFile(path.join(authxDir, "default.json"), "utf8");
    expect(defaultContents).toBe('{"token":"original"}');
  });

  it("lists profiles alphabetically and excludes last-active", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(authxDir, "zebra.json"), "{}");
    await writeFile(path.join(authxDir, "default.json"), "{}");
    await writeFile(path.join(authxDir, "last-active.json"), "{}");
    await writeFile(path.join(authxDir, "alpha.json"), "{}");

    await expect(listProfiles({ homeDir })).resolves.toEqual(["alpha", "default", "zebra"]);
  });
});

describe("authx save", () => {
  it("saves the active auth file into a normalized profile path", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await saveProfile({ homeDir, profileName: "Abc Def" });

    expect(result.profileName).toBe("abc-def");
    await expect(readFile(path.join(codexDir, "authx", "abc-def.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("overwrites an existing user profile with the same slug", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"new"}');
    await writeFile(path.join(authxDir, "team-a.json"), '{"token":"old"}');

    await saveProfile({ homeDir, profileName: "Team A" });

    await expect(readFile(path.join(authxDir, "team-a.json"), "utf8")).resolves.toBe(
      '{"token":"new"}'
    );
  });

  it("fails when there is no active auth file to save", async () => {
    const homeDir = await makeHomeDir();

    await expect(saveProfile({ homeDir, profileName: "Missing" })).rejects.toThrowError(
      "active auth file not found"
    );
  });
});

describe("authx switch", () => {
  it("switches to an existing saved profile", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');
    await writeFile(path.join(authxDir, "team-a.json"), '{"token":"switched"}');

    const result = await switchProfile({ homeDir, profileName: "Team A" });

    expect(result.profileName).toBe("team-a");
    await expect(readFile(path.join(codexDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"switched"}'
    );
  });

  it("backs up the previous active auth file before switching", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"before"}');
    await writeFile(path.join(authxDir, "team-b.json"), '{"token":"after"}');

    await switchProfile({ homeDir, profileName: "Team B" });

    await expect(readFile(path.join(authxDir, "last-active.json"), "utf8")).resolves.toBe(
      '{"token":"before"}'
    );
  });

  it("fails when the target profile does not exist", async () => {
    const homeDir = await makeHomeDir();

    await expect(switchProfile({ homeDir, profileName: "Missing" })).rejects.toThrowError(
      "profile not found: missing"
    );
  });
});

describe("authx cli", () => {
  it("initializes authx and prints version information", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await runCli([], homeDir);

    expect(result.stdout).toContain("authx v0.1.0");
    await expect(readFile(path.join(codexDir, "authx", "default.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("lists profiles one per line", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(authxDir, "default.json"), "{}");
    await writeFile(path.join(authxDir, "team-a.json"), "{}");

    const result = await runCli(["list"], homeDir);

    expect(result.stdout.trim()).toBe("default\nteam-a");
  });

  it("saves the current profile through the cli", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await runCli(["save", "My Profile"], homeDir);

    expect(result.stdout).toContain("saved profile: my-profile");
    await expect(readFile(path.join(codexDir, "authx", "my-profile.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("switches profiles through the cli", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"before"}');
    await writeFile(path.join(authxDir, "team-b.json"), '{"token":"after"}');

    const result = await runCli(["switch", "Team B"], homeDir);

    expect(result.stdout).toContain("switched profile: team-b");
    await expect(readFile(path.join(codexDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"after"}'
    );
  });
});

describe("authx plugin wrapper", () => {
  it("delegates to the cli entrypoint", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(authxDir, "default.json"), "{}");
    await writeFile(path.join(authxDir, "team-a.json"), "{}");

    const result = await runPlugin(["list"], homeDir);

    expect(result.stdout.trim()).toBe("default\nteam-a");
  });
});
