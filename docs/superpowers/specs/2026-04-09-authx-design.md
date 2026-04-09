# Authx Design

Date: 2026-04-09
Status: Draft approved in chat, pending user review of this document

## Overview

`authx` is a local profile switcher for Codex authentication files. It manages multiple `auth.json`-style account files under `~/.codex/authx/` and exposes the workflow in two ways:

- A `Node.js/TypeScript` CLI as the source of truth for behavior
- A thin local Codex plugin/command wrapper so users can invoke `/authx` directly inside Codex

The goal is to let a user rotate between multiple paid Codex accounts by safely saving and switching local auth profiles while keeping the implementation testable and maintainable.

## Goals

- Initialize `~/.codex/authx/` on first use
- Seed `~/.codex/authx/default.json` from `~/.codex/auth.json` when appropriate
- List available saved profiles
- Save the current active auth file under a user-provided nickname
- Switch the active `~/.codex/auth.json` to a saved profile
- Preserve the current active auth file as `last-active.json` before switching
- Support both terminal CLI usage and `/authx` usage in Codex

## Non-Goals

- Remote sync, encryption, or cloud backup
- Multi-user coordination
- Editing auth file contents
- OAuth/login flows
- Automatic account rotation
- Advanced profile metadata management in v1

## Storage Model

Primary storage directory:

- `~/.codex/authx/`

Reserved files:

- `default.json`: seeded from the first observed `~/.codex/auth.json`
- `last-active.json`: internal rollback point created before a switch

User-managed profiles:

- `<slug>.json`

The active Codex auth file remains:

- `~/.codex/auth.json`

## Naming and Safety Rules

User input is never used as a raw filename. Profile names are normalized into a safe slug before any file operation.

Normalization rules:

1. Trim leading and trailing whitespace
2. Convert to lowercase
3. Replace spaces and common separators with `-`
4. Remove characters outside `[a-z0-9-]`
5. Collapse repeated `-`
6. Remove leading and trailing `-`
7. Reject the value if the result is empty

Examples:

- `Abc Def` -> `abc-def.json`
- `  Team_A ` -> `team-a.json`
- `../prod` -> `prod.json`
- `abc.json` -> `abcjson.json`

Additional constraints:

- Raw paths are never accepted
- The implementation always appends `.json` internally
- Reserved names such as `last-active` cannot be used by `save`
- All path building must stay rooted under `~/.codex/authx/`

## Architecture

### Core Layer

`src/core`

Responsible for:

- Resolving canonical paths
- Profile name normalization and validation
- Directory initialization
- File existence checks
- Listing profiles
- Copying and backing up files
- Returning structured results/errors to callers

This layer contains the real business rules and should be mostly independent of CLI formatting.

### CLI Layer

`src/cli`

Responsible for:

- Parsing commands and arguments
- Calling core functions
- Printing concise user-facing output
- Mapping failures to non-zero exit codes

CLI commands in v1:

- `authx`
- `authx list`
- `authx save <name>`
- `authx switch <name>`

### Codex Plugin Wrapper

`plugins/authx`

Responsible for:

- Exposing `/authx` command entrypoints
- Delegating to the CLI instead of reimplementing logic
- Passing through stdout/stderr in a Codex-friendly format

The plugin wrapper must stay thin so the CLI remains the single source of truth.

## Command Semantics

### `authx`

Behavior:

- Print version information
- Ensure `~/.codex/authx/` exists
- If `~/.codex/auth.json` exists and `default.json` does not yet exist, copy it to `~/.codex/authx/default.json`

Expected output is concise and informative, for example indicating whether initialization happened or the directory was already ready.

### `authx list`

Behavior:

- Read `~/.codex/authx/*.json`
- Return one profile name per line
- Exclude `last-active`
- Include `default` and user-saved profiles

The list should be deterministic, ideally sorted alphabetically.

### `authx save <name>`

Behavior:

- Normalize `<name>`
- Reject invalid or reserved names
- Require that `~/.codex/auth.json` currently exists
- Copy the current active auth file to `~/.codex/authx/<slug>.json`

Overwrite behavior for v1:

- Allow overwrite of an existing user profile with the same slug

Rationale:

- This keeps the command simple and avoids forcing prompt logic into the first version.

### `authx switch <name>`

Behavior:

- Normalize `<name>`
- Resolve `~/.codex/authx/<slug>.json`
- Fail if the target profile does not exist
- If `~/.codex/auth.json` exists, back it up to `~/.codex/authx/last-active.json`
- Copy the target profile to `~/.codex/auth.json`

This command should report the switched profile slug on success.

## Error Handling

Expected explicit failures:

- Invalid or empty normalized name
- Attempt to use a reserved name
- Missing `~/.codex/auth.json` on `save`
- Missing target profile on `switch`
- File system permission or copy failures

Error messages should be short and concrete, for example:

- `invalid profile name`
- `reserved profile name: last-active`
- `active auth file not found`
- `profile not found: team-a`

## Testing Strategy

Primary test target is the CLI/core implementation, not the plugin wrapper.

Tests should cover:

- Initializes authx directory when missing
- Seeds `default.json` from `~/.codex/auth.json`
- Does not reseed `default.json` when already present
- Lists profiles excluding `last-active`
- Normalizes profile names correctly
- Rejects empty normalized names
- Rejects reserved names
- Saves current auth file to a normalized profile path
- Switches to a saved profile
- Writes `last-active.json` before switching
- Fails cleanly when switching to a missing profile

Tests should use isolated temporary directories and injected path roots rather than the real home directory.

## Open Implementation Choices Already Decided

- Implementation stack: `Node.js/TypeScript`
- Delivery shape: CLI first, Codex plugin wrapper on top
- Backup strategy: automatic `last-active.json`
- Minimum command set: base command, `list`, `save`, `switch`
- `list` excludes `last-active`
- Profile names are normalized to safe slugs before storage

## Implementation Notes

- Favor standard Node file APIs and a small argument parser
- Keep path resolution centralized
- Keep plugin code minimal and reuse CLI behavior
- Prefer deterministic output suitable for both terminal and Codex rendering

## Known Environment Constraint

The current working directory is not a git repository at the time of writing, so this spec cannot be committed yet. The document is still saved locally for review.

## Next Step

After user review of this document, create a concrete implementation plan and then implement with tests first.
