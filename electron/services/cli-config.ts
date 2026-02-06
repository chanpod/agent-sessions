/**
 * CLI Configuration - Single source of truth for all CLI tool definitions,
 * package names, and shared constants used by cli-detector and cli-installer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported agent IDs for CLI tools */
export type AgentId = 'claude' | 'gemini' | 'codex'

/** Supported installation methods */
export type InstallMethod = 'npm' | 'native' | 'brew'

/**
 * Definition for a CLI tool to detect
 */
export interface CliToolDefinition {
  /** Unique identifier for the tool */
  id: AgentId
  /** Display name for the tool */
  name: string
  /** Commands to try for version detection (tries each until one succeeds) */
  versionCommands: string[]
  /** Commands to try for finding the executable path (tries each until one succeeds) */
  pathCommands: {
    windows: string[]
    unix: string[]
  }
  /** Regex pattern to extract version from command output */
  versionRegex: RegExp
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default regex for extracting semantic versions from CLI output */
export const DEFAULT_VERSION_REGEX = /v?(\d+\.\d+(?:\.\d+)?)/i

/**
 * NPM package names for each CLI tool
 */
export const NPM_PACKAGES: Record<AgentId, string> = {
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
  codex: '@openai/codex',
}

/**
 * Homebrew package names for each CLI tool
 */
export const BREW_PACKAGES: Record<AgentId, { formula?: string; cask?: string }> = {
  claude: {}, // Claude doesn't have a brew package
  gemini: { formula: 'gemini-cli' },
  codex: { cask: 'codex' },
}

/**
 * Native installation scripts/commands
 */
export const NATIVE_INSTALLS: Record<AgentId, { unix?: string; windows?: string }> = {
  claude: {
    unix: 'curl -fsSL https://claude.ai/install.sh | bash',
    windows: 'irm https://claude.ai/install.ps1 | iex',
  },
  gemini: {}, // Gemini doesn't have a native installer (uses npm)
  codex: {}, // Codex doesn't have a native installer (uses npm/brew)
}

// ---------------------------------------------------------------------------
// CLI Tool Definitions
// ---------------------------------------------------------------------------

/**
 * Claude Code CLI definition
 */
export const CLAUDE_CLI: CliToolDefinition = {
  id: 'claude',
  name: 'Claude Code',
  versionCommands: ['claude --version'],
  pathCommands: {
    windows: ['where claude'],
    unix: ['which claude'],
  },
  versionRegex: DEFAULT_VERSION_REGEX,
}

/**
 * Gemini CLI definition
 */
export const GEMINI_CLI: CliToolDefinition = {
  id: 'gemini',
  name: 'Gemini CLI',
  versionCommands: ['gemini --version'],
  pathCommands: {
    windows: ['where gemini'],
    unix: ['which gemini'],
  },
  versionRegex: DEFAULT_VERSION_REGEX,
}

/**
 * OpenAI Codex CLI definition
 */
export const CODEX_CLI: CliToolDefinition = {
  id: 'codex',
  name: 'OpenAI Codex',
  versionCommands: ['codex --version'],
  pathCommands: {
    windows: ['where codex'],
    unix: ['which codex'],
  },
  versionRegex: DEFAULT_VERSION_REGEX,
}

/**
 * All built-in CLI tools
 */
export const BUILTIN_CLI_TOOLS: CliToolDefinition[] = [
  CLAUDE_CLI,
  GEMINI_CLI,
  CODEX_CLI,
]

// ---------------------------------------------------------------------------
// Model Discovery
// ---------------------------------------------------------------------------

/** A model option returned to the renderer */
export interface AgentModelOption {
  id: string
  label: string
  desc: string
}

/** Hardcoded fallback models for Claude (no dynamic source available) */
const CLAUDE_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5', desc: 'Previous gen' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', desc: 'Fast + smart' },
  { id: 'claude-sonnet-4-0', label: 'Sonnet 4', desc: 'Previous gen' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Fastest' },
]

/** Hardcoded fallback models for Codex (used when cache file is missing) */
const CODEX_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', desc: 'Latest' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex', desc: 'Previous gen' },
  { id: 'o3', label: 'o3', desc: 'Reasoning' },
]

/** Hardcoded fallback models for Gemini (no dynamic source available) */
const GEMINI_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Most capable' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Fast' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', desc: 'Fastest' },
]

/**
 * Read Codex models from the CLI's local cache file (~/.codex/models_cache.json).
 * This file is auto-maintained by the Codex CLI and contains the latest model list
 * with metadata like visibility, priority, and descriptions.
 *
 * Returns null if the cache file doesn't exist or can't be parsed.
 */
async function readCodexModelsCache(): Promise<AgentModelOption[] | null> {
  try {
    const fs = await import('fs')
    const path = await import('path')
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    if (!homeDir) return null

    const cachePath = path.join(homeDir, '.codex', 'models_cache.json')
    const content = await fs.promises.readFile(cachePath, 'utf-8')
    const data = JSON.parse(content) as {
      models?: Array<{
        slug: string
        display_name?: string
        description?: string
        visibility?: string
        supported_in_api?: boolean
        priority?: number
      }>
    }

    if (!data.models || !Array.isArray(data.models)) return null

    // Filter to visible, API-supported models and sort by priority
    const models = data.models
      .filter((m) => m.visibility === 'list' && m.supported_in_api !== false)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((m) => ({
        id: m.slug,
        label: m.display_name || m.slug,
        desc: m.description || '',
      }))

    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

/**
 * Get available models for an agent.
 *
 * - Codex: reads from ~/.codex/models_cache.json (dynamic), falls back to hardcoded
 * - Claude: hardcoded (no dynamic source)
 * - Gemini: hardcoded (no dynamic source)
 */
export async function getAgentModels(agentId: string): Promise<AgentModelOption[]> {
  switch (agentId) {
    case 'codex': {
      const cached = await readCodexModelsCache()
      return cached ?? CODEX_FALLBACK_MODELS
    }
    case 'claude':
      return CLAUDE_FALLBACK_MODELS
    case 'gemini':
      return GEMINI_FALLBACK_MODELS
    default:
      return []
  }
}
