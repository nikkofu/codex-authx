# codex-authx

`codex-authx` is a local profile switcher for Codex auth files. It stores multiple `auth.json`-style profiles under `~/.codex/authx/` and lets you initialize, list, save, and switch between them from a local CLI.

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

### Local development install

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

That exposes the `authx` command globally on your machine using the package `bin` entry.

## Usage

### Initialize and print version

```bash
authx
```

Or without `npm link`:

```bash
npm run authx
```

This prints the current version, creates `~/.codex/authx/` if missing, and copies `~/.codex/auth.json` to `~/.codex/authx/default.json` if `default.json` does not already exist.

### List profiles

```bash
authx list
```

Example output:

```text
default
team-a
team-b
```

### Save the current active auth as a named profile

```bash
authx save "Team A"
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
authx switch "Team A"
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

Run the CLI without linking:

```bash
npm run authx -- list
```

## Release Notes Discipline

When publishing changes:

- Update `README.md` if install or usage changed
- Update `CHANGELOG.md`
- Keep CLI install and usage docs aligned with the shipped behavior
