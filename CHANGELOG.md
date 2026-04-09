# Changelog

## 0.1.0 - 2026-04-09

- Added a TypeScript `authx` CLI for initializing, listing, saving, and switching Codex auth profiles.
- Added safe profile-name normalization and reserved-name protection.
- Added automatic `last-active.json` backup during profile switching.
- Added a thin local plugin wrapper under `plugins/authx/`.
- Added a local installer that wires the plugin marketplace and global `/authx` command from the cloned GitHub repo.
- Added command metadata under `commands/authx.md`.
- Added setup, install, and usage documentation.
