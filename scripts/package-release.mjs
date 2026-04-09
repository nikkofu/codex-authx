#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { releaseArchiveEntries, releaseDirectoryNameForTarget } from "../dist/src/release/layout.js";
import {
  archiveFileNameForTarget,
  binaryFileNameForTarget,
  buildOutputPathForTarget
} from "../dist/src/release/targets.js";

export async function packageTargetArtifacts({ repoRoot, artifactsRoot, target }) {
  const releaseRoot = path.join(artifactsRoot, "release");
  const stageDir = path.join(releaseRoot, releaseDirectoryNameForTarget(target));
  const binaryPath = path.join(repoRoot, buildOutputPathForTarget(path.join("artifacts", "bin"), target));
  const archivePath = path.join(releaseRoot, archiveFileNameForTarget(target));

  await mkdir(stageDir, { recursive: true });
  await copyFile(binaryPath, path.join(stageDir, binaryFileNameForTarget(target)));
  await copyFile(path.join(repoRoot, "README.md"), path.join(stageDir, "README.md"));
  await copyFile(path.join(repoRoot, "LICENSE"), path.join(stageDir, "LICENSE"));

  execFileSync("tar", ["-czf", archivePath, "-C", releaseRoot, releaseDirectoryNameForTarget(target)]);

  return {
    archivePath,
    entries: releaseArchiveEntries()
  };
}
