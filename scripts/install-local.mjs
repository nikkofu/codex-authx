#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { installLocally } from "../dist/src/install/local-install.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const paths = await installLocally(repoRoot);

console.log(`installed command: ${paths.globalCommandPath}`);
console.log(`installed plugin: ${paths.installedPluginPath}`);
console.log(`updated marketplace: ${paths.globalMarketplacePath}`);
