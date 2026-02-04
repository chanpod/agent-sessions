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
