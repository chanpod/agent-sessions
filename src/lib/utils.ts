import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a raw model ID into a human-readable display name.
 * Handles Claude, OpenAI/Codex, and generic model IDs.
 *
 * Examples:
 *   "claude-opus-4-6-20260101" → "Opus 4.6"
 *   "claude-3-5-sonnet"        → "Sonnet 3.5"
 *   "opus"                     → "Opus"
 *   "o3"                       → "o3"
 *   "o4-mini"                  → "o4-mini"
 *   "gpt-5.3-codex"            → "GPT-5.3 Codex"
 *   "gpt-5.1-codex-mini"       → "GPT-5.1 Codex Mini"
 *   "gpt-4.1"                  → "GPT-4.1"
 */
export function formatModelDisplayName(raw: string): string {
  const lower = raw.toLowerCase()
  const base = lower.replace(/-\d{8}$/, '') // Strip date suffix

  // Claude new format: claude-{family}-{version} e.g. claude-opus-4-6
  const newFmt = base.match(/^claude-([a-z]+)-([\d]+(?:-[\d]+)*)$/)
  if (newFmt) {
    const family = newFmt[1]!.charAt(0).toUpperCase() + newFmt[1]!.slice(1)
    const version = newFmt[2]!.replace(/-/g, '.')
    return `${family} ${version}`
  }

  // Claude old format: claude-{version}-{family} e.g. claude-3-5-sonnet
  const oldFmt = base.match(/^claude-([\d]+(?:-[\d]+)*)-([a-z]+)$/)
  if (oldFmt) {
    const version = oldFmt[1]!.replace(/-/g, '.')
    const family = oldFmt[2]!.charAt(0).toUpperCase() + oldFmt[2]!.slice(1)
    return `${family} ${version}`
  }

  // Claude config-level short names (opus/sonnet/haiku)
  if (['opus', 'sonnet', 'haiku'].includes(lower)) {
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }

  // OpenAI GPT-Codex models: "gpt-5.3-codex" → "GPT-5.3 Codex"
  const codexFmt = base.match(/^gpt-([\d.]+)-codex(-mini|-max)?$/)
  if (codexFmt) {
    const version = codexFmt[1]!
    const suffix = codexFmt[2] ? ' ' + codexFmt[2].slice(1).charAt(0).toUpperCase() + codexFmt[2].slice(2) : ''
    return `GPT-${version} Codex${suffix}`
  }

  // Other OpenAI GPT models: uppercase "GPT" prefix
  if (lower.startsWith('gpt-')) {
    return 'GPT-' + raw.slice(4)
  }

  // OpenAI o-series and other short model IDs: display as-is
  return raw
}

/**
 * Normalizes a file path by combining basePath and relativePath.
 *
 * @param basePath - The base path (e.g., project root path)
 * @param relativePath - The relative path to append
 * @returns Normalized full path with correct separators
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

  // Remove duplicate separators
  fullPath = fullPath.replace(/\/\/+/g, '/').replace(/\\\\+/g, '\\')

  return fullPath
}
