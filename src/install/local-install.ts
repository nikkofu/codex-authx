import { cp, lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface MarketplacePluginEntry {
  name: string;
  source: {
    source: "local";
    path: string;
  };
  policy: {
    installation: "AVAILABLE";
    authentication: "ON_INSTALL";
  };
  category: "Productivity";
}

export interface MarketplaceFile {
  name: string;
  interface: {
    displayName: string;
  };
  plugins: MarketplacePluginEntry[];
}

export function createMarketplaceEntry(pluginPath: string): MarketplacePluginEntry {
  return {
    name: "authx",
    source: {
      source: "local",
      path: pluginPath
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Productivity"
  };
}

export function upsertMarketplacePlugin(
  marketplace: MarketplaceFile,
  entry: MarketplacePluginEntry
): MarketplaceFile {
  const plugins = marketplace.plugins.filter((plugin) => plugin.name !== entry.name);
  plugins.push(entry);

  return {
    ...marketplace,
    plugins
  };
}

export interface InstallPaths {
  codexCommandsDir: string;
  globalCommandPath: string;
  globalMarketplacePath: string;
  globalPluginsDir: string;
  installedPluginPath: string;
}

export function resolveInstallPaths(homeDir = os.homedir()): InstallPaths {
  return {
    codexCommandsDir: path.join(homeDir, ".codex", "commands"),
    globalCommandPath: path.join(homeDir, ".codex", "commands", "authx.md"),
    globalMarketplacePath: path.join(homeDir, ".agents", "plugins", "marketplace.json"),
    globalPluginsDir: path.join(homeDir, "plugins"),
    installedPluginPath: path.join(homeDir, "plugins", "authx")
  };
}

function defaultMarketplace(): MarketplaceFile {
  return {
    name: "local-authx",
    interface: {
      displayName: "Local Plugins"
    },
    plugins: []
  };
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function replaceWithSymlink(targetPath: string, sourcePath: string): Promise<void> {
  try {
    const stat = await lstat(targetPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await cp(sourcePath, targetPath, { recursive: true, force: true });
      return;
    }
    await unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await symlink(sourcePath, targetPath);
}

export async function installLocally(
  repoRoot: string,
  homeDir = os.homedir()
): Promise<InstallPaths> {
  const paths = resolveInstallPaths(homeDir);
  const repoPluginPath = path.join(repoRoot, "plugins", "authx");
  const repoCommandPath = path.join(repoRoot, "commands", "authx.md");

  await mkdir(paths.codexCommandsDir, { recursive: true });
  await mkdir(path.dirname(paths.globalMarketplacePath), { recursive: true });
  await mkdir(paths.globalPluginsDir, { recursive: true });

  await replaceWithSymlink(paths.globalCommandPath, repoCommandPath);
  await replaceWithSymlink(paths.installedPluginPath, repoPluginPath);

  let marketplace = defaultMarketplace();

  try {
    const current = await readFile(paths.globalMarketplacePath, "utf8");
    marketplace = JSON.parse(current) as MarketplaceFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const updated = upsertMarketplacePlugin(
    marketplace,
    createMarketplaceEntry("./plugins/authx")
  );

  await ensureParentDir(paths.globalMarketplacePath);
  await writeFile(paths.globalMarketplacePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  return paths;
}
