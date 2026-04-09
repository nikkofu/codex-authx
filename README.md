# codex-authx

`codex-authx` is a local profile switcher for Codex auth files. It stores multiple `auth.json`-style profiles under `~/.codex/authx/` and lets you initialize, list, save, and switch between them from a local CLI or a packaged macOS binary.

## Features

- Initializes `~/.codex/authx/` on first run
- Seeds `~/.codex/authx/default.json` from `~/.codex/auth.json`
- Lists saved profiles, excluding the internal `last-active` backup
- Saves the current active auth into a normalized profile filename
- Switches the active `~/.codex/auth.json` to a saved profile
- Backs up the previous active auth file to `~/.codex/authx/last-active.json`

## Requirements

- Node.js 23+ recommended
- npm 11+ recommended
- An existing Codex auth file at `~/.codex/auth.json` if you want `default.json` seeding or `save`

## Installation

### GitHub binary download

Download the matching archive from GitHub Releases:

- `codex-authx-macos-x64.tar.gz`
- `codex-authx-macos-arm64.tar.gz`

After download:

```bash
tar -xzf codex-authx-macos-<arch>.tar.gz
chmod +x codex-authx
./codex-authx list
```

To make it globally runnable:

```bash
mv codex-authx /usr/local/bin/codex-authx
```

### Local source install

```bash
git clone https://github.com/nikkofu/codex-authx.git
cd codex-authx
npm install
```

### Optional local CLI exposure

From the repo root:

```bash
npm link
```

That exposes the `codex-authx` command globally on your machine using the package `bin` entry.

### Build macOS release archives locally

From the repo root:

```bash
npm run build:release
```

On a local machine, this builds the binary for the current macOS architecture and produces the matching pair of outputs:

- Intel macOS:
  - `artifacts/bin/macos-x64/codex-authx`
  - `artifacts/release/codex-authx-macos-x64.tar.gz`
- Apple Silicon macOS:
  - `artifacts/bin/macos-arm64/codex-authx`
  - `artifacts/release/codex-authx-macos-arm64.tar.gz`

In practice:

- on Intel macOS, the local build produces the `macos-x64` archive
- on Apple Silicon macOS, the local build produces the `macos-arm64` archive

The GitHub Actions workflow `.github/workflows/release-binaries.yml` builds both architectures on matching runners and publishes both archives for tagged releases.

The first build may download binary build dependencies for the packager.

### Publish a GitHub Release

1. Update `package.json` `version`
2. Update the matching version section in `CHANGELOG.md`
3. Commit and push to `main`
4. Create a matching tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release workflow enforces that:

- `vX.Y.Z` matches `package.json.version`
- release notes come from the `CHANGELOG.md` section for that version
- both macOS archives are attached to the GitHub Release

## Usage

### Show current status by default

```bash
codex-authx
```

Or:

```bash
codex-authx help
```

Or from source without `npm link`:

```bash
npm run codex-authx -- help
```

Running `codex-authx` with no command prints the current active profile, account id, local rolling usage, and the latest official server-side rate-limit snapshot cached by Codex. On first run it also creates `~/.codex/authx/`, and copies `~/.codex/auth.json` to `~/.codex/authx/default.json` if `default.json` does not already exist.

Use `codex-authx help` to print the usage guide explicitly.

The same first-run initialization also happens before `list`, `save`, and `switch`, so users do not need to run a separate bootstrap command first.

### Daily usage

```bash
codex-authx help
codex-authx
codex-authx list
codex-authx usage
codex-authx save "Team A"
codex-authx switch "Team A"
```

### List profiles

```bash
codex-authx list
```

Example output:

```text
* team-b account_id=acct_456 local 5h=150 7d=900 server 5h=57% 7d=68% reset 2026-04-09T12:20:00.000Z/2026-04-10T12:00:00.000Z
- team-a account_id=acct_123 local 5h=300 7d=450 server=unknown
```

On a first run, `list` also seeds `default.json` automatically when `~/.codex/auth.json` already exists.
If Codex has never been installed or logged in on that machine, `list` may still be empty.

Each line shows:

- whether the profile is current
- the resolved `account_id`
- local rolling usage from the on-disk Codex sqlite state
- the latest available official 5-hour / 7-day server-side snapshot, plus the reset timestamps when available

### Save the current active auth as a named profile

```bash
codex-authx save "Team A"
```

This stores the current `~/.codex/auth.json` as:

```text
~/.codex/authx/team-a.json
```

Profile names are normalized into safe slugs. For example:

- `Abc Def` -> `abc-def.json`
- `QA / Prod` -> `qa-prod.json`

Reserved internal names such as `last-active` cannot be used as saved profile names.

### Switch to a saved profile

```bash
codex-authx switch "Team A"
```

Before switching, the current `~/.codex/auth.json` is backed up to:

```text
~/.codex/authx/last-active.json
```

Then `~/.codex/authx/team-a.json` is copied over `~/.codex/auth.json`.

Each successful switch also appends a local usage snapshot to:

```text
~/.codex/authx/usage-ledger.jsonl
```

That ledger is used for local per-profile usage summaries.

### Show the active profile and account id

```bash
codex-authx whoami
```

Example output:

```text
profile: team-a
account_id: acct_123
```

When multiple saved profiles contain the same auth payload, `whoami` prefers the named profile over `default`.

### Show mixed local/server usage by profile

```bash
codex-authx usage
```

Example output:

```text
current profile: team-b
current account_id: acct_456

- team-a account_id=acct_123 local 5h=300 7d=450 server=unknown
* team-b account_id=acct_456 local 5h=150 7d=900 server 5h=57% 7d=68% reset 2026-04-09T12:20:00.000Z/2026-04-10T12:00:00.000Z
```

Notes:

- Usage is computed locally from `~/.codex/state_5.sqlite` plus `usage-ledger.jsonl`
- Server-side `5h` / `7d` comes from the latest Codex session `rate_limits` snapshot under `~/.codex/sessions/`
- The server value is a usage percentage, not a token count
- The latest resolved official snapshot is persisted to `~/.codex/authx/usage-server.json` for safer fallback
- If no official snapshot is available for a profile yet, `server=unknown` is shown
- Tracking becomes accurate after you start switching profiles with `codex-authx switch`

## File Layout

```text
~/.codex/
  auth.json
  authx/
    default.json
    last-active.json
    usage-ledger.jsonl
    usage-server.json
    team-a.json
    team-b.json
```

## Codex Integration

This project now targets the CLI only. Codex-local command and plugin wrappers were removed after verifying that the current Codex client does not provide a reliable custom extension path for this workflow.

## Development

Run tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build
```

Run the CLI from source without linking:

```bash
npm run codex-authx -- list
```

## Release Notes Discipline

When publishing changes:

- Update `README.md` if install or usage changed
- Update `CHANGELOG.md`
- Keep CLI install and usage docs aligned with the shipped behavior
