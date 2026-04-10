import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeAuthx,
  listProfiles,
  readUsageSummary,
  resolveActiveProfile,
  saveProfile,
  switchProfile
} from "../src/core/authx.js";
import { readStatusSummary } from "../src/core/status.js";
import {
  assertSavableProfileName,
  normalizeProfileName
} from "../src/core/naming.js";
import {
  buildOutputPathForTarget,
  archiveFileNameForTarget,
  binaryFileNameForTarget,
  releaseTargets,
  supportedReleaseTargetsForHost
} from "../src/release/targets.js";
import {
  releaseArchiveEntries,
  releaseDirectoryNameForTarget
} from "../src/release/layout.js";
import {
  extractReleaseNotes,
  normalizeTagVersion,
  validateReleaseTag
} from "../src/release/notes.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
const nowMs = Date.UTC(2026, 3, 9, 12, 0, 0);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    })
  );
});

async function makeHomeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "authx-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(
  args: string[],
  homeDir: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(process.execPath, ["bin/codex-authx.js", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTHX_HOME_DIR: homeDir
      }
    });

    return {
      ...result,
      exitCode: 0
    };
  } catch (error) {
    const execError = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };

    return {
      stdout: execError.stdout || "",
      stderr: execError.stderr || "",
      exitCode: execError.code ?? 1
    };
  }
}

async function runSqlite(dbPath: string, sql: string): Promise<void> {
  await execFileAsync("sqlite3", [dbPath, sql], {
    cwd: process.cwd()
  });
}

async function seedStateDb(
  homeDir: string,
  rows: Array<{ createdAt: number; updatedAt: number; tokensUsed: number; title?: string }>
): Promise<void> {
  const dbPath = path.join(homeDir, ".codex", "state_5.sqlite");
  await mkdir(path.dirname(dbPath), { recursive: true });
  await runSqlite(
    dbPath,
    `
      create table threads (
        id text primary key,
        rollout_path text not null,
        created_at integer not null,
        updated_at integer not null,
        source text not null,
        model_provider text not null,
        cwd text not null,
        title text not null,
        sandbox_policy text not null,
        approval_mode text not null,
        tokens_used integer not null default 0,
        has_user_event integer not null default 0,
        archived integer not null default 0,
        archived_at integer,
        git_sha text,
        git_branch text,
        git_origin_url text,
        cli_version text not null default '',
        first_user_message text not null default '',
        agent_nickname text,
        agent_role text,
        memory_mode text not null default 'enabled',
        model text,
        reasoning_effort text,
        agent_path text
      );
    `
  );

  for (const [index, row] of rows.entries()) {
    await runSqlite(
      dbPath,
      `
        insert into threads (
          id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
          sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
          first_user_message, memory_mode
        ) values (
          'thread-${index}', 'inline', ${row.createdAt}, ${row.updatedAt}, 'cli', 'openai',
          '/tmp/project', '${row.title ?? `Thread ${index}`}', 'workspace-write', 'default',
          ${row.tokensUsed}, 1, 0, '0.1.4', '', 'enabled'
        );
      `
    );
  }
}

async function writeRemoteUsage(
  homeDir: string,
  profiles: Record<
    string,
    {
      accountId: string;
      tokensLast5Hours: number;
      tokensLast7Days: number;
      fetchedAt: string;
    }
  >
): Promise<void> {
  const remotePath = path.join(homeDir, ".codex", "authx", "usage-remote.json");
  await mkdir(path.dirname(remotePath), { recursive: true });
  await writeFile(remotePath, JSON.stringify({ profiles }, null, 2));
}

async function writeSessionRollout(
  homeDir: string,
  relativePath: string,
  lines: unknown[]
): Promise<void> {
  const rolloutPath = path.join(homeDir, ".codex", "sessions", relativePath);
  await mkdir(path.dirname(rolloutPath), { recursive: true });
  await writeFile(
    rolloutPath,
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );
}

describe("authx naming", () => {
  it("normalizes profile names into safe slugs", () => {
    expect(normalizeProfileName("Abc Def")).toBe("abc-def");
  });

  it("collapses repeated separators into a single dash", () => {
    expect(normalizeProfileName("  Team___Alpha / Prod  ")).toBe("team-alpha-prod");
  });

  it("rejects names that normalize to empty", () => {
    expect(() => normalizeProfileName("...///___   ")).toThrowError("invalid profile name");
  });

  it("rejects reserved names for save targets", () => {
    expect(() => assertSavableProfileName("last active")).toThrowError(
      "reserved profile name: last-active"
    );
  });
});

describe("authx initialization and listing", () => {
  it("creates the authx directory and seeds default from the active auth file", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    await initializeAuthx({ homeDir });

    const defaultContents = await readFile(
      path.join(codexDir, "authx", "default.json"),
      "utf8"
    );

    expect(defaultContents).toBe('{"token":"active"}');
  });

  it("does not overwrite an existing default profile", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(homeDir, ".codex", "auth.json"), '{"token":"active"}');
    await writeFile(path.join(authxDir, "default.json"), '{"token":"original"}');

    await initializeAuthx({ homeDir });

    const defaultContents = await readFile(path.join(authxDir, "default.json"), "utf8");
    expect(defaultContents).toBe('{"token":"original"}');
  });

  it("lists profiles alphabetically and excludes internal authx cache files", async () => {
    const homeDir = await makeHomeDir();
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(authxDir, "zebra.json"), "{}");
    await writeFile(path.join(authxDir, "default.json"), "{}");
    await writeFile(path.join(authxDir, "last-active.json"), "{}");
    await writeFile(path.join(authxDir, "usage-remote.json"), "{}");
    await writeFile(path.join(authxDir, "usage-server.json"), "{}");
    await writeFile(path.join(authxDir, "alpha.json"), "{}");

    await expect(listProfiles({ homeDir })).resolves.toEqual(["alpha", "default", "zebra"]);
  });
});

describe("authx save", () => {
  it("saves the active auth file into a normalized profile path", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await saveProfile({ homeDir, profileName: "Abc Def" });

    expect(result.profileName).toBe("abc-def");
    await expect(readFile(path.join(codexDir, "authx", "abc-def.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("overwrites an existing user profile with the same slug", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"new"}');
    await writeFile(path.join(authxDir, "team-a.json"), '{"token":"old"}');

    await saveProfile({ homeDir, profileName: "Team A" });

    await expect(readFile(path.join(authxDir, "team-a.json"), "utf8")).resolves.toBe(
      '{"token":"new"}'
    );
  });

  it("fails when there is no active auth file to save", async () => {
    const homeDir = await makeHomeDir();

    await expect(saveProfile({ homeDir, profileName: "Missing" })).rejects.toThrowError(
      "active auth file not found"
    );
  });
});

describe("authx switch", () => {
  it("switches to an existing saved profile", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');
    await writeFile(path.join(authxDir, "team-a.json"), '{"token":"switched"}');

    const result = await switchProfile({ homeDir, profileName: "Team A" });

    expect(result.profileName).toBe("team-a");
    await expect(readFile(path.join(codexDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"switched"}'
    );
  });

  it("backs up the previous active auth file before switching", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"before"}');
    await writeFile(path.join(authxDir, "team-b.json"), '{"token":"after"}');

    await switchProfile({ homeDir, profileName: "Team B" });

    await expect(readFile(path.join(authxDir, "last-active.json"), "utf8")).resolves.toBe(
      '{"token":"before"}'
    );
  });

  it("fails when the target profile does not exist", async () => {
    const homeDir = await makeHomeDir();

    await expect(switchProfile({ homeDir, profileName: "Missing" })).rejects.toThrowError(
      "profile not found: missing"
    );
  });

  it("records a usage ledger snapshot for the switched profile", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-before" } })
    );
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-team-b" } })
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor(nowMs / 1000) - 1800,
        updatedAt: Math.floor(nowMs / 1000) - 60,
        tokensUsed: 420
      }
    ]);

    await switchProfile({ homeDir, profileName: "Team B", now: new Date(nowMs) });

    const ledger = await readFile(path.join(authxDir, "usage-ledger.jsonl"), "utf8");
    expect(ledger).toContain('"profileName":"team-b"');
    expect(ledger).toContain('"accountId":"acct-team-b"');
    expect(ledger).toContain('"totalTokens":420');
  });
});

describe("authx identity and usage", () => {
  it("resolves the active profile from the active auth file", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    const activeAuth = JSON.stringify({ tokens: { account_id: "acct-team-b" } });
    await writeFile(path.join(codexDir, "auth.json"), activeAuth);
    await writeFile(path.join(authxDir, "team-a.json"), JSON.stringify({ tokens: { account_id: "acct-a" } }));
    await writeFile(path.join(authxDir, "team-b.json"), activeAuth);

    await expect(resolveActiveProfile({ homeDir })).resolves.toMatchObject({
      profileName: "team-b",
      accountId: "acct-team-b"
    });
  });

  it("summarizes usage per profile for the last 5 hours and 7 days", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(authxDir, "team-a.json"),
      JSON.stringify({ tokens: { account_id: "acct-a" } })
    );
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "usage-ledger.jsonl"),
      [
        JSON.stringify({
          timestamp: new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString(),
          profileName: "team-a",
          accountId: "acct-a",
          totalTokens: 100
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 6 * 24 * 60 * 60 * 1000).toISOString(),
          profileName: "team-b",
          accountId: "acct-b",
          totalTokens: 300
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          profileName: "team-a",
          accountId: "acct-a",
          totalTokens: 450
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 30 * 60 * 1000).toISOString(),
          profileName: "team-b",
          accountId: "acct-b",
          totalTokens: 700
        })
      ].join("\n")
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor((nowMs - 60 * 1000) / 1000),
        updatedAt: Math.floor(nowMs / 1000),
        tokensUsed: 900
      }
    ]);

    const summary = await readUsageSummary({ homeDir, now: new Date(nowMs) });

    expect(summary.current).toMatchObject({
      profileName: "team-b",
      accountId: "acct-b"
    });
    expect(summary.profiles).toEqual([
      expect.objectContaining({
        profileName: "team-a",
        accountId: "acct-a",
        tokensLast5Hours: 250,
        tokensLast7Days: 350
      }),
      expect.objectContaining({
        profileName: "team-b",
        accountId: "acct-b",
        tokensLast5Hours: 203,
        tokensLast7Days: 350,
        isActive: true
      })
    ]);
  });
});

describe("authx official rate limit snapshots", () => {
  it("prefers the latest official snapshot from session rollouts for the active profile", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(authxDir, "team-a.json"),
      JSON.stringify({ tokens: { account_id: "acct-a" } })
    );
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "usage-ledger.jsonl"),
      [
        JSON.stringify({
          timestamp: new Date(nowMs - 4 * 60 * 60 * 1000).toISOString(),
          profileName: "team-a",
          accountId: "acct-a",
          totalTokens: 200
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
          profileName: "team-b",
          accountId: "acct-b",
          totalTokens: 500
        })
      ].join("\n")
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor((nowMs - 60 * 1000) / 1000),
        updatedAt: Math.floor(nowMs / 1000),
        tokensUsed: 650
      }
    ]);
    await writeSessionRollout(homeDir, path.join("2026", "04", "09", "rollout-a.jsonl"), [
      {
        timestamp: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 12,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 3600
            },
            secondary: {
              used_percent: 22,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 86400
            },
            credits: null,
            plan_type: "plus"
          }
        }
      },
      {
        timestamp: new Date(nowMs - 30 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 44,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 1800
            },
            secondary: {
              used_percent: 66,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 172800
            },
            credits: {
              has_credits: true,
              unlimited: false,
              balance: "12"
            },
            plan_type: "plus"
          }
        }
      }
    ]);

    const summary = await readStatusSummary({ homeDir, now: new Date(nowMs) });

    expect(summary.current.profileName).toBe("team-b");
    expect(summary.current.server).toMatchObject({
      status: "available",
      source: "official",
      usedPercentLast5Hours: 44,
      usedPercentLast7Days: 66,
      resetsAtLast5Hours: Math.floor(nowMs / 1000) + 1800,
      resetsAtLast7Days: Math.floor(nowMs / 1000) + 172800
    });
    expect(summary.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileName: "team-a",
          server: expect.objectContaining({
            status: "available",
            source: "official",
            usedPercentLast5Hours: 12,
            usedPercentLast7Days: 22
          })
        }),
        expect.objectContaining({
          profileName: "team-b",
          server: expect.objectContaining({
            status: "available",
            source: "official",
            usedPercentLast5Hours: 44,
            usedPercentLast7Days: 66
          })
        })
      ])
    );

    const persisted = JSON.parse(
      await readFile(path.join(authxDir, "usage-server.json"), "utf8")
    ) as {
      profiles: Record<
        string,
        {
          source: string;
          usedPercentLast5Hours: number;
          usedPercentLast7Days: number;
          resetsAtLast5Hours: number;
          resetsAtLast7Days: number;
        }
      >;
    };

    expect(persisted.profiles["team-b"]).toMatchObject({
      source: "official",
      usedPercentLast5Hours: 44,
      usedPercentLast7Days: 66,
      resetsAtLast5Hours: Math.floor(nowMs / 1000) + 1800,
      resetsAtLast7Days: Math.floor(nowMs / 1000) + 172800
    });
  });

  it("falls back to the persisted server snapshot when no session rollout is available", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "usage-server.json"),
      JSON.stringify(
        {
          profiles: {
            "team-b": {
              source: "official",
              usedPercentLast5Hours: 88,
              usedPercentLast7Days: 91,
              resetsAtLast5Hours: Math.floor(nowMs / 1000) + 900,
              resetsAtLast7Days: Math.floor(nowMs / 1000) + 3600,
              fetchedAt: new Date(nowMs - 60 * 1000).toISOString()
            }
          }
        },
        null,
        2
      )
    );

    const summary = await readStatusSummary({ homeDir, now: new Date(nowMs) });

    expect(summary.current.server).toMatchObject({
      status: "available",
      source: "official",
      usedPercentLast5Hours: 88,
      usedPercentLast7Days: 91,
      resetsAtLast5Hours: Math.floor(nowMs / 1000) + 900,
      resetsAtLast7Days: Math.floor(nowMs / 1000) + 3600
    });
  });
});

describe("codex-authx cli", () => {
  it("publishes the codex-authx bin entry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.name).toBe("codex-authx");
    expect(packageJson.bin).toEqual({
      "codex-authx": "./bin/codex-authx.js"
    });
  });

  it("prints current status by default with no command", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(codexDir, { recursive: true });
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "usage-ledger.jsonl"),
      JSON.stringify({
        timestamp: new Date(nowMs - 60 * 60 * 1000).toISOString(),
        profileName: "team-b",
        accountId: "acct-b",
        totalTokens: 500
      })
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor((nowMs - 60 * 1000) / 1000),
        updatedAt: Math.floor(nowMs / 1000),
        tokensUsed: 650
      }
    ]);
    await writeSessionRollout(homeDir, path.join("2026", "04", "09", "rollout-default.jsonl"), [
      {
        timestamp: new Date(nowMs - 5 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 48,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 1200
            },
            secondary: {
              used_percent: 52,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 86400
            },
            credits: null,
            plan_type: "plus"
          }
        }
      }
    ]);

    const result = await runCli([], homeDir);

    expect(result.stdout).toContain("codex-authx v0.1.4");
    expect(result.stdout).toContain("current: team-b");
    expect(result.stdout).toContain("account_id=acct-b");
    expect(result.stdout).toContain("7d=150");
    expect(result.stdout).toContain("server 5h=48% 7d=52% reset");
  });

  it("prints help with the help command", async () => {
    const homeDir = await makeHomeDir();

    const result = await runCli(["help"], homeDir);

    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("codex-authx list");
    expect(result.stdout).toContain("codex-authx save \"Team A\"");
    expect(result.stdout).toContain("codex-authx switch \"Team A\"");
    expect(result.stdout).toContain("codex-authx whoami");
    expect(result.stdout).toContain("codex-authx usage");
  });

  it("lists profiles with current marker and usage status", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(homeDir, ".codex", "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(path.join(authxDir, "default.json"), JSON.stringify({ tokens: { account_id: "acct-b" } }));
    await writeFile(path.join(authxDir, "team-a.json"), JSON.stringify({ tokens: { account_id: "acct-a" } }));
    await writeFile(path.join(authxDir, "team-b.json"), JSON.stringify({ tokens: { account_id: "acct-b" } }));
    await writeFile(
      path.join(authxDir, "usage-ledger.jsonl"),
      [
        JSON.stringify({
          timestamp: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
          profileName: "team-a",
          accountId: "acct-a",
          totalTokens: 200
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 60 * 60 * 1000).toISOString(),
          profileName: "team-b",
          accountId: "acct-b",
          totalTokens: 500
        })
      ].join("\n")
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor((nowMs - 60 * 1000) / 1000),
        updatedAt: Math.floor(nowMs / 1000),
        tokensUsed: 650
      }
    ]);
    await writeSessionRollout(homeDir, path.join("2026", "04", "09", "rollout-list.jsonl"), [
      {
        timestamp: new Date(nowMs - 90 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 22,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 2400
            },
            secondary: {
              used_percent: 34,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 172800
            },
            credits: null,
            plan_type: "plus"
          }
        }
      },
      {
        timestamp: new Date(nowMs - 20 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 57,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 1200
            },
            secondary: {
              used_percent: 68,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 86400
            },
            credits: null,
            plan_type: "plus"
          }
        }
      }
    ]);

    const result = await runCli(["list"], homeDir);

    expect(result.stdout).toContain("* team-b");
    expect(result.stdout).toContain("* team-b account_id=acct-b");
    expect(result.stdout).toContain("7d=150");
    expect(result.stdout).toContain("server 5h=57% 7d=68% reset");
    expect(result.stdout).toContain("- team-a");
    expect(result.stdout).toContain("server 5h=22% 7d=34% reset");
  });

  it("seeds the default profile before listing on first run", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await runCli(["list"], homeDir);

    expect(result.stdout).toContain("* default");
    expect(result.stdout).toContain("server=unknown");
    await expect(readFile(path.join(codexDir, "authx", "default.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("saves the current profile through the cli", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"active"}');

    const result = await runCli(["save", "My Profile"], homeDir);

    expect(result.stdout).toContain("saved profile: my-profile");
    await expect(readFile(path.join(codexDir, "authx", "my-profile.json"), "utf8")).resolves.toBe(
      '{"token":"active"}'
    );
  });

  it("switches profiles through the cli", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(path.join(codexDir, "auth.json"), '{"token":"before"}');
    await writeFile(path.join(authxDir, "team-b.json"), '{"token":"after"}');

    const result = await runCli(["switch", "Team B"], homeDir);

    expect(result.stdout).toContain("switched profile: team-b");
    await expect(readFile(path.join(codexDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"after"}'
    );
  });

  it("prints the active profile and account through whoami", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    const activeAuth = JSON.stringify({ tokens: { account_id: "acct-team-b" } });
    await writeFile(path.join(codexDir, "auth.json"), activeAuth);
    await writeFile(path.join(authxDir, "team-b.json"), activeAuth);

    const result = await runCli(["whoami"], homeDir);

    expect(result.stdout).toContain("profile: team-b");
    expect(result.stdout).toContain("account_id: acct-team-b");
  });

  it("prints usage totals through the usage command", async () => {
    const homeDir = await makeHomeDir();
    const codexDir = path.join(homeDir, ".codex");
    const authxDir = path.join(codexDir, "authx");
    await mkdir(authxDir, { recursive: true });
    await writeFile(
      path.join(authxDir, "team-a.json"),
      JSON.stringify({ tokens: { account_id: "acct-a" } })
    );
    await writeFile(
      path.join(authxDir, "team-b.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ tokens: { account_id: "acct-b" } })
    );
    await writeFile(
      path.join(authxDir, "usage-ledger.jsonl"),
      [
        JSON.stringify({
          timestamp: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
          profileName: "team-a",
          accountId: "acct-a",
          totalTokens: 200
        }),
        JSON.stringify({
          timestamp: new Date(nowMs - 60 * 60 * 1000).toISOString(),
          profileName: "team-b",
          accountId: "acct-b",
          totalTokens: 500
        })
      ].join("\n")
    );
    await seedStateDb(homeDir, [
      {
        createdAt: Math.floor((nowMs - 60 * 1000) / 1000),
        updatedAt: Math.floor(nowMs / 1000),
        tokensUsed: 650
      }
    ]);
    await writeSessionRollout(homeDir, path.join("2026", "04", "09", "rollout-usage.jsonl"), [
      {
        timestamp: new Date(nowMs - 20 * 60 * 1000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 57,
              window_minutes: 300,
              resets_at: Math.floor(nowMs / 1000) + 1200
            },
            secondary: {
              used_percent: 68,
              window_minutes: 10080,
              resets_at: Math.floor(nowMs / 1000) + 86400
            },
            credits: null,
            plan_type: "plus"
          }
        }
      }
    ]);

    const result = await runCli(["usage"], homeDir);

    expect(result.stdout).toContain("* team-b");
    expect(result.stdout).toContain("* team-b account_id=acct-b");
    expect(result.stdout).toContain("7d=150");
    expect(result.stdout).toContain("server 5h=57% 7d=68% reset");
    expect(result.stdout).toContain("- team-a account_id=acct-a");
    expect(result.stdout).toContain("7d=300");
    expect(result.stdout).toContain("server=unknown");
  });

  it("suggests the help command for unknown commands", async () => {
    const homeDir = await makeHomeDir();

    const result = await runCli(["nope"], homeDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command: nope");
    expect(result.stderr).toContain("run 'codex-authx help' for usage");
  });
});

describe("codex-authx release targets", () => {
  it("defines macOS x64 and arm64 binary targets", () => {
    expect(releaseTargets.map((target) => target.id)).toEqual(["macos-x64", "macos-arm64"]);
    expect(releaseTargets.map((target) => target.pkgTarget)).toEqual([
      "node18-macos-x64",
      "node18-macos-arm64"
    ]);
  });

  it("uses codex-authx as the binary file name for all targets", () => {
    expect(releaseTargets.map(binaryFileNameForTarget)).toEqual(["codex-authx", "codex-authx"]);
  });

  it("derives GitHub release archive names from target ids", () => {
    expect(releaseTargets.map(archiveFileNameForTarget)).toEqual([
      "codex-authx-macos-x64.tar.gz",
      "codex-authx-macos-arm64.tar.gz"
    ]);
  });

  it("derives per-target binary output paths", () => {
    expect(releaseTargets.map((target) => buildOutputPathForTarget("artifacts/bin", target))).toEqual(
      [
        path.join("artifacts/bin", "macos-x64", "codex-authx"),
        path.join("artifacts/bin", "macos-arm64", "codex-authx")
      ]
    );
  });

  it("filters local build targets to the current macOS host architecture", () => {
    expect(
      supportedReleaseTargetsForHost({
        platform: "darwin",
        arch: "x64"
      }).map((target) => target.id)
    ).toEqual(["macos-x64"]);

    expect(
      supportedReleaseTargetsForHost({
        platform: "darwin",
        arch: "arm64"
      }).map((target) => target.id)
    ).toEqual(["macos-arm64"]);
  });
});

describe("codex-authx release layout", () => {
  it("defines release directories per target", () => {
    expect(releaseTargets.map(releaseDirectoryNameForTarget)).toEqual([
      "codex-authx-macos-x64",
      "codex-authx-macos-arm64"
    ]);
  });

  it("includes the binary, README, and LICENSE in each release archive", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
    const buildScript = await readFile(path.join(process.cwd(), "scripts", "build-release.mjs"), "utf8");

    expect(packageJson.scripts["build:js"]).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts["build:bin"]).toBe("node ./scripts/build-release.mjs");
    expect(packageJson.scripts["build:release"]).toBe("npm run build:js && npm run build:bin");
    expect(buildScript).toContain("@yao-pkg/pkg/package.json");
    expect(releaseArchiveEntries()).toEqual(["codex-authx", "README.md", "LICENSE"]);
  });

  it("uses supported GitHub Actions runner labels and node24-compatible actions", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("runner: macos-15-intel");
    expect(workflow).toContain("runner: macos-14");
    expect(workflow).toContain("uses: actions/checkout@v5");
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("uses: actions/upload-artifact@v6");
    expect(workflow).toContain("uses: actions/download-artifact@v8");
    expect(workflow).not.toContain("softprops/action-gh-release");
  });

  it("only validates release tags on tag-triggered runs", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("- name: Verify release tag matches package version");
    expect(workflow).toContain(
      "- name: Verify release tag matches package version\n        if: startsWith(github.ref, 'refs/tags/v')"
    );
  });

  it("allows workflow_dispatch runs to target an explicit release tag", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("inputs:");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("required: true");
    expect(workflow).toContain("ref: ${{ github.event.inputs.release_tag || github.ref }}");
  });

  it("grants publish permission to create GitHub releases", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("publish:");
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: write");
  });

  it("publishes any downloaded release archives without assuming artifact subpaths", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain("path: /tmp/release-artifacts");
    expect(workflow).toContain("find /tmp/release-artifacts -type f -name '*.tar.gz'");
  });

  it("publishes releases via gh cli with an explicit GitHub token", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8"
    );

    expect(workflow).toContain(
      "if: startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'"
    );
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(workflow).toContain('TAG_NAME: ${{ github.event.inputs.release_tag || github.ref_name }}');
    expect(workflow).toContain("gh release view");
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--draft=false");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("gh release upload");
  });
});

describe("codex-authx release notes", () => {
  it("extracts the changelog section for the package version", async () => {
    const changelog = await readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");

    expect(extractReleaseNotes(changelog, "0.1.0")).toContain(
      "Renamed the public command to `codex-authx`."
    );
  });

  it("normalizes git tags by stripping the leading v", () => {
    expect(normalizeTagVersion("v0.1.0")).toBe("0.1.0");
  });

  it("validates that the release tag matches package.json version", () => {
    expect(() => validateReleaseTag("v0.1.0", "0.1.0")).not.toThrow();
    expect(() => validateReleaseTag("v0.1.1", "0.1.0")).toThrowError(
      "release tag v0.1.1 does not match package.json version 0.1.0"
    );
  });
});
