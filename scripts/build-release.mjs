#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { build } from "esbuild";

import { packageTargetArtifacts } from "./package-release.mjs";
import {
  buildOutputPathForTarget,
  supportedReleaseTargetsForHost
} from "../dist/src/release/targets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const artifactsRoot = path.join(repoRoot, "artifacts");
const pkgCachePath = path.join(repoRoot, ".cache", "pkg");
const bundlePath = path.join(artifactsRoot, "bundle", "codex-authx.cjs");
const pkgBinaryPath = path.join(repoRoot, "node_modules", ".bin", "pkg");
const buildTargets = supportedReleaseTargetsForHost({
  platform: process.platform,
  arch: process.arch
});

await rm(artifactsRoot, { recursive: true, force: true });
await mkdir(path.dirname(bundlePath), { recursive: true });
await mkdir(pkgCachePath, { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "src", "cli", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: bundlePath
});

for (const target of buildTargets) {
  const outputPath = path.join(repoRoot, buildOutputPathForTarget(path.join("artifacts", "bin"), target));
  await mkdir(path.dirname(outputPath), { recursive: true });

  execFileSync(
    pkgBinaryPath,
    [
      bundlePath,
      "--targets",
      target.pkgTarget,
      "--output",
      outputPath,
      "--compress",
      "GZip",
      "--public",
      "--public-packages",
      "*"
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "1",
        PKG_CACHE_PATH: pkgCachePath
      }
    }
  );

  await packageTargetArtifacts({ repoRoot, artifactsRoot, target });
}

for (const target of buildTargets) {
  const archivePath = path.join(
    repoRoot,
    "artifacts",
    "release",
    `codex-authx-${target.id}.tar.gz`
  );
  console.log(archivePath);
}
