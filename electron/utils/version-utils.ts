/**
 * Semantic version comparison utilities.
 */

/**
 * Strip pre-release suffix and leading 'v' from a version string.
 * e.g. "v1.2.3-beta.1" → "1.2.3"
 */
function normalizeVersion(version: string): string {
  return version.replace(/^v/, '').replace(/-.*$/, '')
}

/**
 * Compare two semantic version strings.
 * Returns true if `latest` is strictly newer than `current`.
 *
 * Handles formats like "1.2.3", "v1.2.3", "1.2", "1.0.28-beta.1".
 * Pre-release suffixes are stripped before comparison.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = normalizeVersion(current).split('.').map(Number)
  const latestParts = normalizeVersion(latest).split('.').map(Number)

  // Pad arrays to same length
  while (currentParts.length < 3) currentParts.push(0)
  while (latestParts.length < 3) latestParts.push(0)

  for (let i = 0; i < 3; i++) {
    if (isNaN(latestParts[i]) || isNaN(currentParts[i])) continue
    if (latestParts[i] > currentParts[i]) return true
    if (latestParts[i] < currentParts[i]) return false
  }

  return false
}
