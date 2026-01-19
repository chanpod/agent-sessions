/**
 * File Identification System
 *
 * Provides stable, unique identifiers for files across all review sessions.
 * FileId = "projectId:relativePath" - never changes even when file content changes
 * CacheKey = "fileId:contentHash" - used for versioned cache lookups
 */

/**
 * Stable identifier for a file within a project.
 * Format: "projectId:relativePath"
 * Example: "/home/user/myproject:src/app.tsx"
 */
export type FileId = string

/**
 * Cache key combining FileId and content hash.
 * Format: "fileId:contentHash"
 * Example: "/home/user/myproject:src/app.tsx:abc123def"
 */
export type CacheKey = string

/**
 * File metadata with stable identity and version tracking
 */
export interface FileMetadata {
  fileId: FileId                    // Stable: "projectId:relativePath"
  projectId: string                 // Project root path
  relativePath: string              // Relative to project root
  currentHash: string               // Current content hash (from git diff)
  lastReviewedHash?: string         // Hash from last successful review
  lastReviewedAt?: number           // Timestamp of last review
}

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
 * Parse a FileId back into its components
 */
export function parseFileId(fileId: FileId): { projectId: string; relativePath: string } | null {
  const colonIndex = fileId.indexOf(':')
  if (colonIndex === -1) return null

  return {
    projectId: fileId.substring(0, colonIndex),
    relativePath: fileId.substring(colonIndex + 1)
  }
}

/**
 * Generate a cache key from FileId and content hash
 */
export function generateCacheKey(fileId: FileId, contentHash: string): CacheKey {
  return `${fileId}:${contentHash}`
}

/**
 * Parse a cache key back into its components
 */
export function parseCacheKey(cacheKey: CacheKey): { fileId: FileId; contentHash: string } | null {
  const lastColonIndex = cacheKey.lastIndexOf(':')
  if (lastColonIndex === -1) return null

  return {
    fileId: cacheKey.substring(0, lastColonIndex),
    contentHash: cacheKey.substring(lastColonIndex + 1)
  }
}

/**
 * Check if a cache key matches a FileId (ignoring hash)
 */
export function cacheKeyMatchesFileId(cacheKey: CacheKey, fileId: FileId): boolean {
  return cacheKey.startsWith(`${fileId}:`)
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

/**
 * Create FileMetadata from project info and file path
 */
export function createFileMetadata(
  projectId: string,
  relativePath: string,
  currentHash: string
): FileMetadata {
  const fileId = generateFileId(projectId, relativePath)

  return {
    fileId,
    projectId,
    relativePath,
    currentHash
  }
}

/**
 * Check if two FileIds refer to the same file (even if different projects)
 */
export function isSameFile(fileId1: FileId, fileId2: FileId): boolean {
  return fileId1 === fileId2
}

/**
 * Get all cache keys for a given FileId (for clearing all versions)
 */
export function getCachePrefix(fileId: FileId): string {
  return `${fileId}:`
}
