# Changelog

## 0.1.3 - 2026-04-09

- Replaced the default no-argument help screen with a status-first dashboard showing the current profile, local rolling usage, and the latest official 5-hour / 7-day Codex rate-limit snapshot.
- Added profile-aware status rendering to `codex-authx list`, including current-profile markers, local token estimates, official server usage percentages, and reset timestamps.
- Added mixed local/server usage reporting to `codex-authx usage`, with official snapshots sourced from Codex session rollouts under `~/.codex/sessions/`.
- Persisted the latest resolved official server snapshot to `~/.codex/authx/usage-server.json` for safe fallback without modifying auth credentials.
- Kept `whoami` available while shifting the primary workflow to `codex-authx`, `codex-authx list`, and `codex-authx usage`.

## 0.1.2 - 2026-04-09

- Added `codex-authx help` and made the no-argument command print a usage guide instead of only a status line.
- Improved unknown-command errors to point users to `codex-authx help`.
- Expanded README daily usage guidance to cover help, first-run initialization, and common profile workflows.

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
