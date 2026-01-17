import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizes a file path by combining basePath and relativePath while preserving
 * UNC paths (e.g., \\wsl.localhost\Ubuntu\... or \\wsl$\Ubuntu\...).
 *
 * This is critical for Windows <-> WSL file access scenarios where UNC paths
 * must maintain their leading double-backslash format.
 *
 * @param basePath - The base path (e.g., project root path)
 * @param relativePath - The relative path to append
 * @returns Normalized full path with correct separators and preserved UNC format
 */
export function normalizeFilePath(basePath: string, relativePath: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  let fullPath = `${basePath}${separator}${relativePath}`

  // Normalize path separators to match the basePath format
  if (separator === '\\') {
    fullPath = fullPath.replace(/\//g, '\\')
  } else {
    fullPath = fullPath.replace(/\\/g, '/')
  }

  // Remove duplicate separators, but preserve UNC path prefix (\\wsl.localhost or \\wsl$)
  const isUncPath = /^\\\\wsl(?:\$|\.localhost)\\/i.test(fullPath)
  if (isUncPath) {
    // For UNC paths, preserve the leading \\ and remove other duplicates
    fullPath = fullPath.replace(/^(\\\\wsl(?:\$|\.localhost)\\)/, '$1').replace(/(\\)\\+/g, '$1')
  } else {
    fullPath = fullPath.replace(/\/\/+/g, '/').replace(/\\\\+/g, '\\')
  }

  return fullPath
}
