#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractReleaseNotes, validateReleaseTag } from "../src/release/notes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
const tag = process.argv[2];
const outputPath = process.argv[3];

if (!tag || !outputPath) {
  throw new Error("usage: node scripts/extract-release-notes.mjs <tag> <output-path>");
}

validateReleaseTag(tag, version);

const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const notes = extractReleaseNotes(changelog, version);

await writeFile(outputPath, `${notes}\n`, "utf8");
