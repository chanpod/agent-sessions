/**
 * Browser-compatible path utilities
 * Mirrors essential functions from electron/utils/path-service.ts
 * for use in React components
 */

/**
 * Normalize path separators to forward slashes.
 */
export function normalize(inputPath: string): string {
  if (!inputPath) return ''

  return inputPath.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/**
 * Join path segments with forward slashes
 */
export function join(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}

/**
 * Get file name from path
 */
export function basename(inputPath: string): string {
  if (!inputPath) return ''
  const normalized = normalize(inputPath)
  const parts = normalized.split('/')
  return parts[parts.length - 1] || ''
}

/**
 * Get directory path
 */
export function dirname(inputPath: string): string {
  if (!inputPath) return ''
  const normalized = normalize(inputPath)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return normalized.substring(0, lastSlash)
}

/**
 * Get file extension
 */
export function extname(inputPath: string): string {
  const name = basename(inputPath)
  const lastDot = name.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return name.substring(lastDot)
}

/**
 * Check if path is absolute (Windows drive or Unix root)
 */
export function isAbsolute(inputPath: string): boolean {
  if (!inputPath) return false
  const normalized = normalize(inputPath)
  // Unix absolute
  if (normalized.startsWith('/')) return true
  // Windows drive
  if (/^[A-Za-z]:/.test(inputPath)) return true
  // UNC path
  if (inputPath.startsWith('\\\\')) return true
  return false
}

/**
 * Get relative path by removing base path prefix
 */
export function relative(basePath: string, fullPath: string): string {
  const normalizedBase = normalize(basePath).replace(/\/$/, '')
  const normalizedFull = normalize(fullPath)

  if (normalizedFull.startsWith(normalizedBase + '/')) {
    return normalizedFull.substring(normalizedBase.length + 1)
  }
  if (normalizedFull.startsWith(normalizedBase)) {
    return normalizedFull.substring(normalizedBase.length).replace(/^\//, '')
  }
  return normalizedFull
}

/**
 * Check if paths are equivalent (after normalization)
 */
export function isSamePath(path1: string, path2: string): boolean {
  return normalize(path1) === normalize(path2)
}

export const PathUtils = {
  normalize,
  join,
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  isSamePath
}
