const RESERVED_PROFILE_NAMES = new Set(["last-active"]);

export function normalizeProfileName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("invalid profile name");
  }

  return normalized;
}

export function assertSavableProfileName(input: string): string {
  const profileName = normalizeProfileName(input);

  if (RESERVED_PROFILE_NAMES.has(profileName)) {
    throw new Error(`reserved profile name: ${profileName}`);
  }

  return profileName;
}

export function isReservedProfileName(profileName: string): boolean {
  return RESERVED_PROFILE_NAMES.has(profileName);
}
