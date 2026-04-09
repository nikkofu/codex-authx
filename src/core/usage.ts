import { execFile } from "node:child_process";
import { access, appendFile, readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";

import { isReservedProfileName } from "./naming.js";
import { resolveAuthxPaths, resolveProfilePath } from "./paths.js";

const execFileAsync = promisify(execFile);
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const INTERNAL_PROFILE_FILES = new Set(["usage-remote"]);

export interface UsageLedgerEvent {
  timestamp: string;
  profileName: string;
  accountId: string | null;
  totalTokens: number;
}

export interface ActiveProfileSummary {
  profileName: string | null;
  accountId: string | null;
}

export interface UsageProfileSummary {
  profileName: string;
  accountId: string | null;
  isActive: boolean;
  tokensLast5Hours: number;
  tokensLast7Days: number;
}

export interface UsageSummary {
  current: ActiveProfileSummary;
  profiles: UsageProfileSummary[];
}

interface ProfileDescriptor {
  profileName: string;
  accountId: string | null;
  raw: string;
}

export async function readAuthFile(filePath: string): Promise<{ raw: string; accountId: string | null }> {
  const raw = await readFile(filePath, "utf8");
  return {
    raw,
    accountId: extractAccountId(raw)
  };
}

export function extractAccountId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      tokens?: {
        account_id?: unknown;
      };
    };
    const accountId = parsed.tokens?.account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

export async function resolveActiveProfile({
  homeDir
}: {
  homeDir: string;
}): Promise<ActiveProfileSummary> {
  const paths = resolveAuthxPaths(homeDir);
  const active = await readAuthFile(paths.authFile);
  const profiles = await readProfileDescriptors(homeDir);

  const exactMatch = preferNamedProfile(profiles.filter((profile) => profile.raw === active.raw));
  if (exactMatch) {
    return {
      profileName: exactMatch.profileName,
      accountId: active.accountId
    };
  }

  const accountMatch = preferNamedProfile(
    profiles.filter((profile) => profile.accountId === active.accountId)
  );
  return {
    profileName: accountMatch?.profileName ?? null,
    accountId: active.accountId
  };
}

export async function appendUsageLedgerEvent({
  homeDir,
  profileName,
  accountId,
  totalTokens,
  now
}: {
  homeDir: string;
  profileName: string;
  accountId: string | null;
  totalTokens: number;
  now?: Date;
}): Promise<void> {
  const { usageLedgerFile } = resolveAuthxPaths(homeDir);
  const event: UsageLedgerEvent = {
    timestamp: (now ?? new Date()).toISOString(),
    profileName,
    accountId,
    totalTokens
  };
  await appendFile(usageLedgerFile, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readUsageSummary({
  homeDir,
  now
}: {
  homeDir: string;
  now?: Date;
}): Promise<UsageSummary> {
  const currentTime = now ?? new Date();
  const profiles = await readProfileDescriptors(homeDir);
  const current = await resolveActiveProfile({ homeDir });
  const totalTokens = await readTotalTokens(homeDir);
  const events = await readUsageLedger(homeDir);
  const profileSummaries = new Map<string, UsageProfileSummary>();

  for (const profile of profiles) {
    profileSummaries.set(profile.profileName, {
      profileName: profile.profileName,
      accountId: profile.accountId,
      isActive: current.profileName === profile.profileName,
      tokensLast5Hours: 0,
      tokensLast7Days: 0
    });
  }

  const currentMatchesLast =
    events.length > 0 &&
    events.at(-1)?.profileName === current.profileName &&
    events.at(-1)?.accountId === current.accountId;

  const segments = events.flatMap((event, index) => {
    const nextEvent = events[index + 1];
    const end = nextEvent ? new Date(nextEvent.timestamp) : currentMatchesLast ? currentTime : null;
    const endTotal = nextEvent ? nextEvent.totalTokens : currentMatchesLast ? totalTokens : null;

    if (!end || endTotal === null) {
      return [];
    }

    return [
      {
        profileName: event.profileName,
        start: new Date(event.timestamp),
        end,
        tokenDelta: Math.max(0, endTotal - event.totalTokens)
      }
    ];
  });

  for (const segment of segments) {
    const profile = profileSummaries.get(segment.profileName);
    if (!profile) {
      continue;
    }

    profile.tokensLast5Hours += allocateWindowTokens(segment, currentTime.getTime() - FIVE_HOURS_MS, currentTime);
    profile.tokensLast7Days += allocateWindowTokens(segment, currentTime.getTime() - SEVEN_DAYS_MS, currentTime);
  }

  return {
    current,
    profiles: Array.from(profileSummaries.values()).sort((left, right) =>
      left.profileName.localeCompare(right.profileName)
    )
  };
}

async function readProfileDescriptors(homeDir: string): Promise<ProfileDescriptor[]> {
  const profileNames = await listProfileNames(homeDir);
  const descriptors = await Promise.all(
    profileNames.map(async (profileName) => {
      const profile = await readAuthFile(resolveProfilePath(homeDir, profileName));
      return {
        profileName,
        accountId: profile.accountId,
        raw: profile.raw
      };
    })
  );

  return descriptors;
}

async function listProfileNames(homeDir: string): Promise<string[]> {
  const { authxDir } = resolveAuthxPaths(homeDir);

  try {
    const entries = await readdir(authxDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .filter((name) => !INTERNAL_PROFILE_FILES.has(name))
      .filter((name) => !isReservedProfileName(name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
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

export async function readTotalTokens(homeDir: string): Promise<number> {
  const { stateDbFile } = resolveAuthxPaths(homeDir);

  try {
    await access(stateDbFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }

    throw error;
  }

  const result = await execFileAsync("sqlite3", [
    stateDbFile,
    "select coalesce(sum(tokens_used), 0) from threads;"
  ]);
  const total = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(total) ? total : 0;
}

function allocateWindowTokens(
  segment: {
    start: Date;
    end: Date;
    tokenDelta: number;
  },
  windowStartMs: number,
  now: Date
): number {
  const segmentStartMs = segment.start.getTime();
  const segmentEndMs = segment.end.getTime();
  const overlapStart = Math.max(segmentStartMs, windowStartMs);
  const overlapEnd = Math.min(segmentEndMs, now.getTime());

  if (overlapEnd <= overlapStart || segmentEndMs <= segmentStartMs || segment.tokenDelta <= 0) {
    return 0;
  }

  const fraction = (overlapEnd - overlapStart) / (segmentEndMs - segmentStartMs);
  return Math.round(segment.tokenDelta * fraction);
}

function preferNamedProfile<T extends { profileName: string }>(profiles: T[]): T | undefined {
  return profiles.sort((left, right) => {
    if (left.profileName === "default" && right.profileName !== "default") {
      return 1;
    }

    if (left.profileName !== "default" && right.profileName === "default") {
      return -1;
    }

    return left.profileName.localeCompare(right.profileName);
  })[0];
}
