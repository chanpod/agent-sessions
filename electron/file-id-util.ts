/**
 * File ID utilities for Electron main process
 * Shared logic with frontend (src/lib/file-id.ts)
 */

export type FileId = string

/**
 * Generate a stable FileId from project path and relative file path
 */
export function generateFileId(projectId: string, relativePath: string): FileId {
  // Normalize paths to handle Windows/Unix differences
  const normalizedProject = normalizePath(projectId)
  const normalizedRelative = normalizePath(relativePath)
  return `${normalizedProject}:${normalizedRelative}`
}

/**
 * Normalize path for consistent comparison across platforms
 */
function normalizePath(path: string): string {
  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/')

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}
