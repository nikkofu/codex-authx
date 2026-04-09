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

### Initialize and print version

```bash
codex-authx
```

Or from source without `npm link`:

```bash
npm run codex-authx
```

This prints the current version, creates `~/.codex/authx/` if missing, and copies `~/.codex/auth.json` to `~/.codex/authx/default.json` if `default.json` does not already exist.

The same first-run initialization also happens before `list`, `save`, and `switch`, so users do not need to run a separate bootstrap command first.

### List profiles

```bash
codex-authx list
```

Example output:

```text
default
team-a
team-b
```

On a first run, `list` also seeds `default.json` automatically when `~/.codex/auth.json` already exists.

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

## File Layout

```text
~/.codex/
  auth.json
  authx/
    default.json
    last-active.json
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
