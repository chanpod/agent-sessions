/**
 * Semantic version comparison utilities.
 */

/**
 * Compare two semantic version strings.
 * Returns true if `latest` is strictly newer than `current`.
 *
 * Handles formats like "1.2.3", "v1.2.3", "1.2".
 * Pre-release suffixes (e.g. "-beta.1") are stripped before comparison.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.replace(/^v/, '').split('.').map(Number)
  const latestParts = latest.replace(/^v/, '').split('.').map(Number)

  // Pad arrays to same length
  while (currentParts.length < 3) currentParts.push(0)
  while (latestParts.length < 3) latestParts.push(0)

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true
    if (latestParts[i] < currentParts[i]) return false
  }

  return false
}
