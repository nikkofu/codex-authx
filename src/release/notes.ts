export function normalizeTagVersion(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function validateReleaseTag(tag: string, packageVersion: string): void {
  const normalizedTag = normalizeTagVersion(tag);

  if (normalizedTag !== packageVersion) {
    throw new Error(`release tag ${tag} does not match package.json version ${packageVersion}`);
  }
}

export function extractReleaseNotes(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const header = `## ${version} - `;
  const startIndex = lines.findIndex((line) => line.startsWith(header));

  if (startIndex === -1) {
    throw new Error(`release notes not found for version ${version}`);
  }

  const collected: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.startsWith("## ")) {
      break;
    }

    collected.push(line);
  }

  return collected.join("\n").trim();
}
