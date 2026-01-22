# Main.ts Refactor Design Document

## Overview

This document outlines the systematic cleanup and refactoring of `electron/main.ts`. All changes must maintain backward compatibility and be validated through unit tests.

**File:** `electron/main.ts`
**Current State:** ~1800+ lines with identified code quality issues
**Goal:** Cleaner, more maintainable code with proper test coverage

---

## Phase 1: Quick Fixes (Low Risk)

### 1.1 Remove Unused Import
- **Location:** Line 14
- **Change:** Remove `basename` from path import
- **Test:** Compile check only (no runtime behavior change)

### 1.2 Remove Orphaned Comment
- **Location:** Lines 1276-1277
- **Change:** Delete orphaned comment about git info
- **Test:** None required

### 1.3 Fix Null Safety Issue
- **Location:** Line 1612
- **Change:** Replace `BrowserWindow.getAllWindows()[0]` with `mainWindow` reference
- **Test:** Unit test for null handling in the affected function

---

## Phase 2: Extract Constants (Low Risk)

### 2.1 Create Constants Object

**New file:** `electron/constants.ts`

```typescript
export const CONSTANTS = {
  // Timeouts
  UPDATE_DISMISS_TIMEOUT_MS: 24 * 60 * 60 * 1000,  // 24 hours
  UPDATE_CHECK_INTERVAL_MS: 5 * 60 * 1000,          // 5 minutes
  DB_WAIT_TIMEOUT_MS: 5000,
  REVIEW_TIMEOUT_MS: 60000,
  COORDINATOR_TIMEOUT_MS: 90000,
  ACCURACY_TIMEOUT_MS: 120000,

  // Window dimensions
  WINDOW_DEFAULT_WIDTH: 1400,
  WINDOW_DEFAULT_HEIGHT: 900,
  WINDOW_MIN_WIDTH: 800,
  WINDOW_MIN_HEIGHT: 600,

  // Limits
  MAX_DIRECTORY_DEPTH: 10,
  REVIEW_BATCH_SIZE: 5,
}
```

**Test:** Import and verify all constants have expected values

---

## Phase 3: Consolidate WSL Utilities (Medium Risk)

### 3.1 Current State

Three locations with duplicated WSL logic:
- `detectWslPath()` (lines 29-49)
- `execInContext()` (lines 82-101)
- `execInContextAsync()` (lines 137-146)

### 3.2 Target State

**New file:** `electron/utils/wsl.ts`

```typescript
export interface WslPathInfo {
  isWslPath: boolean
  distro: string | null
  linuxPath: string | null
}

export function detectWslPath(windowsPath: string): WslPathInfo

export function getWslDistros(): string[]

export function getDefaultWslDistro(): string | null {
  const distros = getWslDistros()
  return distros[0] || null
}

export function buildWslCommand(
  command: string,
  projectPath: string,
  wslInfo: WslPathInfo
): { cmd: string; cwd: string | undefined }

export function isWslEnvironment(): boolean
```

### 3.3 Unit Tests Required

```typescript
// electron/utils/__tests__/wsl.test.ts

describe('WSL Utilities', () => {
  describe('detectWslPath', () => {
    it('should detect \\\\wsl$ paths', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu\\home\\user')
      expect(result.isWslPath).toBe(true)
      expect(result.distro).toBe('Ubuntu')
    })

    it('should detect \\\\wsl.localhost paths', () => {
      const result = detectWslPath('\\\\wsl.localhost\\Debian\\home')
      expect(result.isWslPath).toBe(true)
      expect(result.distro).toBe('Debian')
    })

    it('should return false for regular Windows paths', () => {
      const result = detectWslPath('C:\\Users\\test')
      expect(result.isWslPath).toBe(false)
    })
  })

  describe('buildWslCommand', () => {
    it('should build correct WSL command with distro', () => {
      const wslInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home/user' }
      const result = buildWslCommand('ls -la', 'C:\\path', wslInfo)
      expect(result.cmd).toContain('wsl')
      expect(result.cmd).toContain('-d Ubuntu')
    })

    it('should escape quotes in command', () => {
      const wslInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home' }
      const result = buildWslCommand('echo "hello"', 'C:\\path', wslInfo)
      expect(result.cmd).toContain('\\"')
    })
  })

  describe('getDefaultWslDistro', () => {
    it('should return first distro from list', () => {
      // Mock getWslDistros to return test data
    })

    it('should return null when no distros available', () => {
      // Mock getWslDistros to return empty array
    })
  })
})
```

---

## Phase 4: Move Interfaces to Top of File (Low Risk)

### 4.1 Interfaces to Move

| Interface | Current Location | Description |
|-----------|------------------|-------------|
| `ShellInfo` | Lines 916-919 | Inside IPC handler |
| `ScriptInfo` | Lines 1023-1026 | Inside IPC handler |
| `PackageScripts` | Lines 1028-1033 | Inside IPC handler |

### 4.2 Target Location

Move all interfaces after imports, before any function definitions (~line 25).

### 4.3 Test

Compile check - interfaces are type-only, no runtime behavior change.

---

## Phase 5: Extract Large Functions (High Risk)

### 5.1 Extract `project:get-scripts` Handler

**Current:** 254 lines (lines 1020-1274)

**Target Structure:**

```typescript
// electron/services/package-scripts.ts

export interface PackageScriptResult {
  scripts: ScriptInfo[]
  packageManager: string
}

export async function findPackageJsonFiles(
  dir: string,
  rootDir: string,
  depth?: number
): Promise<string[]>

export function detectPackageManager(packageDir: string): string

export function buildRemotePackageScript(): string

export async function getPackageScriptsLocal(
  projectPath: string
): Promise<PackageScriptResult>

export async function getPackageScriptsRemote(
  sshManager: SSHManager,
  projectId: string,
  projectPath: string
): Promise<PackageScriptResult>
```

### 5.2 Unit Tests Required

```typescript
// electron/services/__tests__/package-scripts.test.ts

describe('Package Scripts Service', () => {
  describe('findPackageJsonFiles', () => {
    it('should find package.json in root directory', async () => {
      // Use temp directory with test package.json
    })

    it('should respect max depth limit', async () => {
      // Create nested structure beyond limit
    })

    it('should skip node_modules directories', async () => {
      // Ensure node_modules is excluded
    })
  })

  describe('detectPackageManager', () => {
    it('should detect yarn from yarn.lock', () => {
      // Create temp dir with yarn.lock
    })

    it('should detect pnpm from pnpm-lock.yaml', () => {
      // Create temp dir with pnpm-lock.yaml
    })

    it('should default to npm', () => {
      // Directory with no lock files
    })
  })

  describe('getPackageScriptsLocal', () => {
    it('should return scripts from package.json', async () => {
      // Create temp package.json with known scripts
    })

    it('should handle missing package.json gracefully', async () => {
      // Empty directory
    })
  })
})
```

### 5.3 Extract `review:review-high-risk-file` Handler

**Current:** 144 lines (lines 1682-1826)

**Target Structure:**

```typescript
// electron/services/code-review.ts

export interface ReviewStage {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface SubAgentResult {
  findings: Finding[]
  agentId: string
}

export async function runSubAgentReviews(
  files: FileInfo[],
  config: ReviewConfig
): Promise<SubAgentResult[]>

export async function consolidateFindings(
  subAgentResults: SubAgentResult[],
  config: ReviewConfig
): Promise<Finding[]>

export async function verifyAccuracy(
  findings: Finding[],
  passes: number,
  config: ReviewConfig
): Promise<Finding[]>

export async function reviewHighRiskFile(
  file: FileInfo,
  config: ReviewConfig,
  onStatusUpdate: (status: ReviewStage) => void
): Promise<ReviewResult>
```

### 5.4 Unit Tests Required

```typescript
// electron/services/__tests__/code-review.test.ts

describe('Code Review Service', () => {
  describe('runSubAgentReviews', () => {
    it('should run multiple agents in parallel', async () => {
      // Mock Claude API calls
    })

    it('should handle agent failures gracefully', async () => {
      // Simulate one agent failing
    })
  })

  describe('consolidateFindings', () => {
    it('should deduplicate identical findings', () => {
      // Findings from multiple agents with duplicates
    })

    it('should preserve unique findings from each agent', () => {
      // Different findings from different agents
    })
  })

  describe('verifyAccuracy', () => {
    it('should filter out false positives', async () => {
      // Mock accuracy verification responses
    })

    it('should run specified number of passes', async () => {
      // Verify correct number of API calls
    })
  })
})
```

---

## Phase 6: Improve Type Safety (Medium Risk)

### 6.1 Replace `any` Types

**Create type definitions:**

```typescript
// electron/types/index.ts

export interface Finding {
  file: string
  line: number
  column?: number
  severity: 'critical' | 'error' | 'warning' | 'suggestion'
  message: string
  code?: string
  suggestion?: string
}

export interface ExecOptions {
  cwd?: string
  encoding?: BufferEncoding
  timeout?: number
  maxBuffer?: number
  env?: NodeJS.ProcessEnv
}

export interface ReviewConfig {
  projectPath: string
  projectId: string
  timeout?: number
}

export interface FileInfo {
  path: string
  content: string
  diff?: string
  imports?: string[]
}
```

### 6.2 Locations to Update

| Location | Current Type | Target Type |
|----------|--------------|-------------|
| Line 119 | `catch (error: any)` | `catch (error: unknown)` |
| Line 135 | `let execOptions: any` | `let execOptions: ExecOptions` |
| Line 1188 | `catch (error: any)` | `catch (error: unknown)` |
| Various | `findings: any[]` | `findings: Finding[]` |

### 6.3 Test

TypeScript compilation - no runtime tests needed for type changes.

---

## Phase 7: Reduce Console Logging (Low Risk)

### 7.1 Create Logger Utility

```typescript
// electron/utils/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface Logger {
  debug: (prefix: string, message: string, ...args: any[]) => void
  info: (prefix: string, message: string, ...args: any[]) => void
  warn: (prefix: string, message: string, ...args: any[]) => void
  error: (prefix: string, message: string, ...args: any[]) => void
}

const LOG_LEVEL: LogLevel = process.env.LOG_LEVEL as LogLevel || 'info'

export const logger: Logger = {
  debug: (prefix, message, ...args) => {
    if (shouldLog('debug')) console.log(`[${prefix}]`, message, ...args)
  },
  info: (prefix, message, ...args) => {
    if (shouldLog('info')) console.log(`[${prefix}]`, message, ...args)
  },
  warn: (prefix, message, ...args) => {
    if (shouldLog('warn')) console.warn(`[${prefix}]`, message, ...args)
  },
  error: (prefix, message, ...args) => {
    if (shouldLog('error')) console.error(`[${prefix}]`, message, ...args)
  },
}
```

### 7.2 Test

```typescript
describe('Logger', () => {
  it('should respect log level settings', () => {
    // Mock console and verify filtering
  })

  it('should format messages with prefix', () => {
    // Verify output format
  })
})
```

---

## Implementation Order

| Order | Phase | Risk | Estimated Scope | Dependencies |
|-------|-------|------|-----------------|--------------|
| 1 | Phase 1: Quick Fixes | Low | 3 changes | None |
| 2 | Phase 4: Move Interfaces | Low | 3 interfaces | None |
| 3 | Phase 2: Extract Constants | Low | 1 new file | None |
| 4 | Phase 6: Type Safety | Medium | ~20 changes | Phase 2 |
| 5 | Phase 7: Logger Utility | Low | 1 new file, ~69 updates | None |
| 6 | Phase 3: WSL Utilities | Medium | 1 new file, 3 refactors | Phase 6 |
| 7 | Phase 5: Extract Functions | High | 2 new files, major refactors | All above |

---

## Validation Checklist

### Before Each Phase
- [ ] All existing tests pass
- [ ] Application builds without errors
- [ ] Manual smoke test: app launches and basic features work

### After Each Phase
- [ ] New unit tests written and passing
- [ ] All existing tests still pass
- [ ] Application builds without errors
- [ ] Manual smoke test completed
- [ ] No TypeScript errors
- [ ] Git commit created with descriptive message

### Final Validation
- [ ] Full test suite passes
- [ ] Application builds for all platforms
- [ ] Manual testing of affected features:
  - [ ] WSL path detection and execution
  - [ ] Package script discovery
  - [ ] Code review functionality
  - [ ] SSH remote operations
- [ ] No regression in functionality

---

## Sub-Agent Instructions

When implementing any phase, sub-agents should:

1. **Read this document first** to understand the full context
2. **Follow the phase order** unless explicitly told otherwise
3. **Write tests before or alongside code changes**
4. **Run existing tests** after changes to catch regressions
5. **Keep changes minimal** - only what's specified in the phase
6. **Report blockers** if dependencies aren't met

### Validation Commands

```bash
# TypeScript compilation check
npm run build

# Run all tests
npm test

# Run specific test file
npm test -- --testPathPattern="wsl.test"

# Run tests with coverage
npm test -- --coverage
```

---

## Notes

- This refactor maintains backward compatibility - no API changes
- All IPC handlers keep the same signatures
- File extraction creates new modules but main.ts orchestration remains
- Tests focus on extracted utilities, not IPC handlers directly
