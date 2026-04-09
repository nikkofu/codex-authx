import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAuthxPaths } from "./paths.js";
import { readUsageSummary, type UsageProfileSummary } from "./usage.js";

export interface RemoteUsageSummary {
  status: "available" | "unknown";
  source?: "official" | "cached";
  usedPercentLast5Hours?: number;
  usedPercentLast7Days?: number;
  resetsAtLast5Hours?: number;
  resetsAtLast7Days?: number;
  fetchedAt?: string;
}

export interface ProfileStatusSummary {
  profileName: string;
  accountId: string | null;
  isActive: boolean;
  local: {
    tokensLast5Hours: number;
    tokensLast7Days: number;
  };
  server: RemoteUsageSummary;
}

export interface StatusSummary {
  current: {
    profileName: string | null;
    accountId: string | null;
    local: {
      tokensLast5Hours: number;
      tokensLast7Days: number;
    } | null;
    server: RemoteUsageSummary;
  };
  profiles: ProfileStatusSummary[];
}

interface RemoteUsageFile {
  profiles?: Record<
    string,
    {
      accountId?: string;
      tokensLast5Hours?: number;
      tokensLast7Days?: number;
      fetchedAt?: string;
    }
  >;
}

interface PersistedServerUsageFile {
  profiles?: Record<
    string,
    {
      source?: "official" | "cached";
      usedPercentLast5Hours?: number;
      usedPercentLast7Days?: number;
      resetsAtLast5Hours?: number;
      resetsAtLast7Days?: number;
      fetchedAt?: string;
    }
  >;
}

interface UsageLedgerEvent {
  timestamp: string;
  profileName: string;
  accountId: string | null;
  totalTokens: number;
}

interface OfficialRateLimitSnapshot {
  timestamp: string;
  usedPercentLast5Hours?: number;
  usedPercentLast7Days?: number;
  resetsAtLast5Hours?: number;
  resetsAtLast7Days?: number;
}

export async function readStatusSummary({
  homeDir,
  now
}: {
  homeDir: string;
  now?: Date;
}): Promise<StatusSummary> {
  const localSummary = await readUsageSummary({ homeDir, now });
  const profileServerSummaries = await readServerUsageByProfile(homeDir, localSummary.current.profileName);

  const profiles = localSummary.profiles.map((profile) =>
    buildProfileStatus(profile, profileServerSummaries)
  );
  const currentProfile = profiles.find((profile) => profile.isActive);

  return {
    current: {
      profileName: localSummary.current.profileName,
      accountId: localSummary.current.accountId,
      local: currentProfile
        ? {
            tokensLast5Hours: currentProfile.local.tokensLast5Hours,
            tokensLast7Days: currentProfile.local.tokensLast7Days
          }
        : null,
      server: currentProfile?.server ?? { status: "unknown" }
    },
    profiles
  };
}

function buildProfileStatus(
  profile: UsageProfileSummary,
  serverSummaries: Map<string, RemoteUsageSummary>
): ProfileStatusSummary {
  return {
    profileName: profile.profileName,
    accountId: profile.accountId,
    isActive: profile.isActive,
    local: {
      tokensLast5Hours: profile.tokensLast5Hours,
      tokensLast7Days: profile.tokensLast7Days
    },
    server: serverSummaries.get(profile.profileName) ?? { status: "unknown" }
  };
}

async function readServerUsageByProfile(
  homeDir: string,
  currentProfileName: string | null
): Promise<Map<string, RemoteUsageSummary>> {
  const official = await readOfficialUsageByProfile(homeDir, currentProfileName);
  await persistServerUsage(homeDir, official);
  const persisted = await readPersistedServerUsage(homeDir);
  for (const [profileName, summary] of persisted.entries()) {
    if (!official.has(profileName)) {
      official.set(profileName, summary);
    }
  }
  const cached = await readCachedRemoteUsage(homeDir);

  for (const [profileName, summary] of cached.entries()) {
    if (!official.has(profileName)) {
      official.set(profileName, summary);
    }
  }

  return official;
}

async function readOfficialUsageByProfile(
  homeDir: string,
  currentProfileName: string | null
): Promise<Map<string, RemoteUsageSummary>> {
  const ledgerEvents = await readUsageLedger(homeDir);
  const snapshots = await readOfficialSnapshots(homeDir);
  const latestByProfile = new Map<string, OfficialRateLimitSnapshot>();

  for (const snapshot of snapshots) {
    const profileName = resolveProfileForTimestamp(snapshot.timestamp, ledgerEvents, currentProfileName);
    if (!profileName) {
      continue;
    }

    const previous = latestByProfile.get(profileName);
    if (!previous || previous.timestamp.localeCompare(snapshot.timestamp) < 0) {
      latestByProfile.set(profileName, snapshot);
    }
  }

  return new Map(
    Array.from(latestByProfile.entries()).map(([profileName, snapshot]) => [
      profileName,
      {
        status: "available",
        source: "official",
        usedPercentLast5Hours: snapshot.usedPercentLast5Hours,
        usedPercentLast7Days: snapshot.usedPercentLast7Days,
        resetsAtLast5Hours: snapshot.resetsAtLast5Hours,
        resetsAtLast7Days: snapshot.resetsAtLast7Days,
        fetchedAt: snapshot.timestamp
      } satisfies RemoteUsageSummary
    ])
  );
}

function resolveProfileForTimestamp(
  timestamp: string,
  ledgerEvents: UsageLedgerEvent[],
  currentProfileName: string | null
): string | null {
  let matched: UsageLedgerEvent | null = null;

  for (const event of ledgerEvents) {
    if (event.timestamp.localeCompare(timestamp) <= 0) {
      matched = event;
      continue;
    }

    break;
  }

  return matched?.profileName ?? currentProfileName;
}

async function readOfficialSnapshots(homeDir: string): Promise<OfficialRateLimitSnapshot[]> {
  const sessionsDir = path.join(homeDir, ".codex", "sessions");
  const rolloutFiles = await listRolloutFiles(sessionsDir);
  const snapshots = (
    await Promise.all(rolloutFiles.map(async (filePath) => extractSnapshotsFromRollout(filePath)))
  ).flat();

  return snapshots.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

async function listRolloutFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return listRolloutFiles(entryPath);
        }

        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          return [entryPath];
        }

        return [];
      })
    );

    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function extractSnapshotsFromRollout(filePath: string): Promise<OfficialRateLimitSnapshot[]> {
  const raw = await readFile(filePath, "utf8");
  const snapshots: OfficialRateLimitSnapshot[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const parsed = JSON.parse(trimmed) as {
      timestamp?: string;
      type?: string;
      payload?: {
        type?: string;
        rate_limits?: {
          primary?: {
            used_percent?: number | null;
            window_minutes?: number | null;
            resets_at?: number | null;
          } | null;
          secondary?: {
            used_percent?: number | null;
            window_minutes?: number | null;
            resets_at?: number | null;
          } | null;
        } | null;
      };
    };

    if (
      parsed.type !== "event_msg" ||
      parsed.payload?.type !== "token_count" ||
      typeof parsed.timestamp !== "string" ||
      !parsed.payload.rate_limits
    ) {
      continue;
    }

    snapshots.push({
      timestamp: parsed.timestamp,
      usedPercentLast5Hours: normalizeWindowPercent(parsed.payload.rate_limits.primary, 300),
      usedPercentLast7Days: normalizeWindowPercent(parsed.payload.rate_limits.secondary, 10080),
      resetsAtLast5Hours: normalizeWindowReset(parsed.payload.rate_limits.primary, 300),
      resetsAtLast7Days: normalizeWindowReset(parsed.payload.rate_limits.secondary, 10080)
    });
  }

  return snapshots;
}

function normalizeWindowPercent(
  window:
    | {
        used_percent?: number | null;
        window_minutes?: number | null;
        resets_at?: number | null;
      }
    | null
    | undefined,
  expectedMinutes: number
): number | undefined {
  if (window?.window_minutes !== expectedMinutes || typeof window.used_percent !== "number") {
    return undefined;
  }

  return window.used_percent;
}

function normalizeWindowReset(
  window:
    | {
        used_percent?: number | null;
        window_minutes?: number | null;
        resets_at?: number | null;
      }
    | null
    | undefined,
  expectedMinutes: number
): number | undefined {
  if (window?.window_minutes !== expectedMinutes || typeof window.resets_at !== "number") {
    return undefined;
  }

  return window.resets_at;
}

async function readCachedRemoteUsage(homeDir: string): Promise<Map<string, RemoteUsageSummary>> {
  const { remoteUsageFile } = resolveAuthxPaths(homeDir);

  try {
    const raw = await readFile(remoteUsageFile, "utf8");
    const parsed = JSON.parse(raw) as RemoteUsageFile;
    const profiles = new Map<string, RemoteUsageSummary>();

    for (const [profileName, value] of Object.entries(parsed.profiles ?? {})) {
      if (
        typeof value.tokensLast5Hours === "number" &&
        typeof value.tokensLast7Days === "number"
      ) {
        profiles.set(profileName, {
          status: "available",
          source: "cached",
          usedPercentLast5Hours: value.tokensLast5Hours,
          usedPercentLast7Days: value.tokensLast7Days,
          fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : undefined
        });
      }
    }

    return profiles;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

async function persistServerUsage(
  homeDir: string,
  summaries: Map<string, RemoteUsageSummary>
): Promise<void> {
  if (summaries.size === 0) {
    return;
  }

  const { serverUsageFile } = resolveAuthxPaths(homeDir);
  const payload: PersistedServerUsageFile = {
    profiles: Object.fromEntries(
      Array.from(summaries.entries()).map(([profileName, summary]) => [
        profileName,
        {
          source: summary.source,
          usedPercentLast5Hours: summary.usedPercentLast5Hours,
          usedPercentLast7Days: summary.usedPercentLast7Days,
          resetsAtLast5Hours: summary.resetsAtLast5Hours,
          resetsAtLast7Days: summary.resetsAtLast7Days,
          fetchedAt: summary.fetchedAt
        }
      ])
    )
  };

  await mkdir(path.dirname(serverUsageFile), { recursive: true });
  await writeFile(serverUsageFile, JSON.stringify(payload, null, 2), "utf8");
}

async function readPersistedServerUsage(homeDir: string): Promise<Map<string, RemoteUsageSummary>> {
  const { serverUsageFile } = resolveAuthxPaths(homeDir);

  try {
    const raw = await readFile(serverUsageFile, "utf8");
    const parsed = JSON.parse(raw) as PersistedServerUsageFile;
    const profiles = new Map<string, RemoteUsageSummary>();

    for (const [profileName, value] of Object.entries(parsed.profiles ?? {})) {
      if (
        typeof value.usedPercentLast5Hours === "number" &&
        typeof value.usedPercentLast7Days === "number"
      ) {
        profiles.set(profileName, {
          status: "available",
          source: value.source ?? "official",
          usedPercentLast5Hours: value.usedPercentLast5Hours,
          usedPercentLast7Days: value.usedPercentLast7Days,
          resetsAtLast5Hours:
            typeof value.resetsAtLast5Hours === "number" ? value.resetsAtLast5Hours : undefined,
          resetsAtLast7Days:
            typeof value.resetsAtLast7Days === "number" ? value.resetsAtLast7Days : undefined,
          fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : undefined
        });
      }
    }

    return profiles;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

async function readUsageLedger(homeDir: string): Promise<UsageLedgerEvent[]> {
  const { usageLedgerFile } = resolveAuthxPaths(homeDir);

  try {
    const raw = await readFile(usageLedgerFile, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as UsageLedgerEvent)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
