#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliPath = path.resolve(__dirname, "../../../bin/authx.js");
const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
