import { copyFile, mkdir, readdir } from "node:fs/promises";

import { assertSavableProfileName, isReservedProfileName } from "./naming.js";
import { resolveAuthxPaths, resolveProfilePath } from "./paths.js";
import {
  appendUsageLedgerEvent,
  readAuthFile,
  readTotalTokens,
  readUsageSummary,
  resolveActiveProfile
} from "./usage.js";

export interface AuthxOptions {
  homeDir: string;
}

const INTERNAL_PROFILE_FILES = new Set(["usage-remote", "usage-server"]);

export interface SaveProfileOptions extends AuthxOptions {
  profileName: string;
  now?: Date;
}

export async function initializeAuthx({
  homeDir
}: AuthxOptions): Promise<{ initialized: boolean; seededDefault: boolean }> {
  const paths = resolveAuthxPaths(homeDir);
  await mkdir(paths.authxDir, { recursive: true });

  let seededDefault = false;

  try {
    await copyFile(paths.authFile, paths.defaultProfile, 1);
    seededDefault = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EEXIST") {
      throw error;
    }
  }

  return {
    initialized: true,
    seededDefault
  };
}

export async function listProfiles({ homeDir }: AuthxOptions): Promise<string[]> {
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

export async function saveProfile({
  homeDir,
  profileName
}: SaveProfileOptions): Promise<{ profileName: string }> {
  const normalizedName = assertSavableProfileName(profileName);
  const paths = resolveAuthxPaths(homeDir);

  await mkdir(paths.authxDir, { recursive: true });

  try {
    await copyFile(paths.authFile, resolveProfilePath(homeDir, normalizedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("active auth file not found");
    }

    throw error;
  }

  return { profileName: normalizedName };
}

export async function switchProfile({
  homeDir,
  profileName,
  now
}: SaveProfileOptions): Promise<{ profileName: string }> {
  const normalizedName = assertSavableProfileName(profileName);
  const paths = resolveAuthxPaths(homeDir);
  const targetProfile = resolveProfilePath(homeDir, normalizedName);

  await mkdir(paths.authxDir, { recursive: true });

  try {
    await copyFile(paths.authFile, paths.lastActiveProfile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await copyFile(targetProfile, paths.authFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`profile not found: ${normalizedName}`);
    }

    throw error;
  }

  const targetAuth = await readAuthFile(targetProfile);
  await appendUsageLedgerEvent({
    homeDir,
    profileName: normalizedName,
    accountId: targetAuth.accountId,
    totalTokens: await readTotalTokens(homeDir),
    now
  });

  return { profileName: normalizedName };
}

export { readUsageSummary, resolveActiveProfile };
