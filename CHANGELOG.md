# Changelog

## 0.1.1 - 2026-04-09

- Fixed first-run CLI behavior so `list`, `save`, and `switch` also initialize `~/.codex/authx/`.
- Fixed first-run profile seeding so `codex-authx list` now auto-creates `default.json` when `~/.codex/auth.json` already exists.
- Switched GitHub Release publishing from `softprops/action-gh-release` to `gh release` and hardened the workflow against manual runs and artifact path issues.

## 0.1.0 - 2026-04-09

- Added a TypeScript `authx` CLI for initializing, listing, saving, and switching Codex auth profiles.
- Renamed the public command to `codex-authx`.
- Added macOS x64 and arm64 binary release build support and release archive packaging.
- Added safe profile-name normalization and reserved-name protection.
- Added automatic `last-active.json` backup during profile switching.
- Added setup, install, and usage documentation.
- Removed the abandoned Codex plugin/command integration path and kept the project CLI-only.
