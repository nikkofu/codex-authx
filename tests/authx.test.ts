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
import {
  buildOutputPathForTarget,
  archiveFileNameForTarget,
  binaryFileNameForTarget,
  releaseTargets,
  supportedReleaseTargetsForHost
} from "../src/release/targets.js";
import {
  releaseArchiveEntries,
  releaseDirectoryNameForTarget
} from "../src/release/layout.js";
import {
  extractReleaseNotes,
  normalizeTagVersion,
  validateReleaseTag
} from "../src/release/notes.js";

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
  return execFileAsync(process.execPath, ["bin/codex-authx.js", ...args], {
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

describe("codex-authx cli", () => {
  it("publishes the codex-authx bin entry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.name).toBe("codex-authx");
    expect(packageJson.bin).toEqual({
      "codex-authx": "./bin/codex-authx.js"
    });
  });

  it("initializes authx and prints version information", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await runCli([], homeDir);

    expect(result.stdout).toContain("codex-authx v0.1.0");
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

describe("codex-authx release targets", () => {
  it("defines macOS x64 and arm64 binary targets", () => {
    expect(releaseTargets.map((target) => target.id)).toEqual(["macos-x64", "macos-arm64"]);
    expect(releaseTargets.map((target) => target.pkgTarget)).toEqual([
      "node18-macos-x64",
      "node18-macos-arm64"
    ]);
  });

  it("uses codex-authx as the binary file name for all targets", () => {
    expect(releaseTargets.map(binaryFileNameForTarget)).toEqual(["codex-authx", "codex-authx"]);
  });

  it("derives GitHub release archive names from target ids", () => {
    expect(releaseTargets.map(archiveFileNameForTarget)).toEqual([
      "codex-authx-macos-x64.tar.gz",
      "codex-authx-macos-arm64.tar.gz"
    ]);
  });

  it("derives per-target binary output paths", () => {
    expect(releaseTargets.map((target) => buildOutputPathForTarget("artifacts/bin", target))).toEqual(
      [
        path.join("artifacts/bin", "macos-x64", "codex-authx"),
        path.join("artifacts/bin", "macos-arm64", "codex-authx")
      ]
    );
  });

  it("filters local build targets to the current macOS host architecture", () => {
    expect(
      supportedReleaseTargetsForHost({
        platform: "darwin",
        arch: "x64"
      }).map((target) => target.id)
    ).toEqual(["macos-x64"]);

    expect(
      supportedReleaseTargetsForHost({
        platform: "darwin",
        arch: "arm64"
      }).map((target) => target.id)
    ).toEqual(["macos-arm64"]);
  });
});

describe("codex-authx release layout", () => {
  it("defines release directories per target", () => {
    expect(releaseTargets.map(releaseDirectoryNameForTarget)).toEqual([
      "codex-authx-macos-x64",
      "codex-authx-macos-arm64"
    ]);
  });

  it("includes the binary, README, and LICENSE in each release archive", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.scripts["build:js"]).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts["build:bin"]).toBe("node ./scripts/build-release.mjs");
    expect(packageJson.scripts["build:release"]).toBe("npm run build:js && npm run build:bin");
    expect(releaseArchiveEntries()).toEqual(["codex-authx", "README.md", "LICENSE"]);
  });

  it("uses supported GitHub Actions runner labels and node24-compatible actions", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("runner: macos-15-intel");
    expect(workflow).toContain("runner: macos-14");
    expect(workflow).toContain("uses: actions/checkout@v5");
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("uses: actions/upload-artifact@v6");
    expect(workflow).toContain("uses: actions/download-artifact@v5");
  });
});

describe("codex-authx release notes", () => {
  it("extracts the changelog section for the package version", async () => {
    const changelog = await readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");

    expect(extractReleaseNotes(changelog, "0.1.0")).toContain(
      "Renamed the public command to `codex-authx`."
    );
  });

  it("normalizes git tags by stripping the leading v", () => {
    expect(normalizeTagVersion("v0.1.0")).toBe("0.1.0");
  });

  it("validates that the release tag matches package.json version", () => {
    expect(() => validateReleaseTag("v0.1.0", "0.1.0")).not.toThrow();
    expect(() => validateReleaseTag("v0.1.1", "0.1.0")).toThrowError(
      "release tag v0.1.1 does not match package.json version 0.1.0"
    );
  });
});
