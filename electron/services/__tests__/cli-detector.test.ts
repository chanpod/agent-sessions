/**
 * Tests for CLI Detector Service
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import {
  detectCliTool,
  detectAllCliTools,
  createCliToolDefinition,
  type CliToolDetectionResult,
} from '../cli-detector.js'
import {
  CLAUDE_CLI,
  GEMINI_CLI,
  CODEX_CLI,
  BUILTIN_CLI_TOOLS,
  type CliToolDefinition,
} from '../cli-config.js'

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

// Mock path-service
vi.mock('../../utils/path-service.js', () => ({
  PathService: {
    getExecutionContext: vi.fn(),
    analyzePath: vi.fn(),
  },
}))

// Import mocked modules
import { exec } from 'child_process'
import { PathService } from '../../utils/path-service.js'

// Type for exec mock
type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void
type ExecMock = Mock<[string, unknown, ExecCallback], void>

describe('CLI Detector Service', () => {
  let originalPlatform: string

  beforeEach(() => {
    originalPlatform = process.platform
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  // Helper to set platform
  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', {
      value: platform,
      writable: true,
      configurable: true,
    })
  }

  // Helper to mock exec for success
  function mockExecSuccess(stdout: string, stderr = '') {
    ;(exec as unknown as ExecMock).mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        callback(null, { stdout, stderr })
      }
    })
  }

  // Helper to mock exec for failure
  function mockExecFailure(errorMessage: string) {
    ;(exec as unknown as ExecMock).mockImplementation((_cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        const error = new Error(errorMessage)
        callback(error)
      }
    })
  }

  // Helper to mock exec with command-specific responses
  function mockExecByCommand(responses: Record<string, { stdout?: string; error?: string }>) {
    ;(exec as unknown as ExecMock).mockImplementation((cmd, _opts, callback) => {
      if (typeof callback === 'function') {
        const cmdStr = cmd as string
        for (const [pattern, response] of Object.entries(responses)) {
          if (cmdStr.includes(pattern)) {
            if (response.error) {
              callback(new Error(response.error))
            } else {
              callback(null, { stdout: response.stdout || '', stderr: '' })
            }
            return
          }
        }
        // Default: command not found
        callback(new Error('command not found'))
      }
    })
  }

  describe('Built-in Tool Definitions', () => {
    it('should have correct structure for CLAUDE_CLI', () => {
      expect(CLAUDE_CLI.id).toBe('claude')
      expect(CLAUDE_CLI.name).toBe('Claude Code')
      expect(CLAUDE_CLI.versionCommands).toContain('claude --version')
      expect(CLAUDE_CLI.pathCommands.windows).toContain('where claude')
      expect(CLAUDE_CLI.pathCommands.unix).toContain('which claude')
      expect(CLAUDE_CLI.versionRegex).toBeInstanceOf(RegExp)
    })

    it('should have correct structure for GEMINI_CLI', () => {
      expect(GEMINI_CLI.id).toBe('gemini')
      expect(GEMINI_CLI.name).toBe('Gemini CLI')
      expect(GEMINI_CLI.versionCommands).toContain('gemini --version')
      expect(GEMINI_CLI.pathCommands.windows).toContain('where gemini')
      expect(GEMINI_CLI.pathCommands.unix).toContain('which gemini')
    })

    it('should have correct structure for CODEX_CLI', () => {
      expect(CODEX_CLI.id).toBe('codex')
      expect(CODEX_CLI.name).toBe('OpenAI Codex')
      expect(CODEX_CLI.versionCommands).toContain('codex --version')
      expect(CODEX_CLI.pathCommands.windows).toContain('where codex')
      expect(CODEX_CLI.pathCommands.unix).toContain('which codex')
    })

    it('should include all built-in tools in BUILTIN_CLI_TOOLS', () => {
      expect(BUILTIN_CLI_TOOLS).toHaveLength(3)
      expect(BUILTIN_CLI_TOOLS.map((t) => t.id)).toEqual(['claude', 'gemini', 'codex'])
    })
  })

  describe('detectCliTool', () => {
    describe('Local Windows context', () => {
      beforeEach(() => {
        setPlatform('win32')
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-windows')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'windows',
          original: 'C:\\project',
          normalized: 'C:/project',
          isAbsolute: true,
        })
      })

      it('should detect installed Claude CLI', async () => {
        mockExecByCommand({
          'claude --version': { stdout: 'claude version 1.0.5\n' },
          'where claude': { stdout: 'C:\\Users\\user\\AppData\\Local\\bin\\claude.exe\n' },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.id).toBe('claude')
        expect(result.name).toBe('Claude Code')
        expect(result.installed).toBe(true)
        expect(result.version).toBe('1.0.5')
        expect(result.path).toBe('C:\\Users\\user\\AppData\\Local\\bin\\claude.exe')
      })

      it('should detect tool via path when version command fails', async () => {
        mockExecByCommand({
          'claude --version': { error: 'is not recognized' },
          'where claude': { stdout: 'C:\\bin\\claude.exe\n' },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.installed).toBe(true)
        expect(result.version).toBeUndefined()
        expect(result.path).toBe('C:\\bin\\claude.exe')
      })

      it('should return not installed when tool is not found', async () => {
        mockExecByCommand({
          'claude --version': { error: 'is not recognized' },
          'where claude': { error: 'is not recognized' },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.installed).toBe(false)
        expect(result.version).toBeUndefined()
        expect(result.path).toBeUndefined()
      })

      it('should extract version with v prefix', async () => {
        mockExecByCommand({
          'claude --version': { stdout: 'claude v2.3.4\n' },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.version).toBe('2.3.4')
      })

      it('should extract version without v prefix', async () => {
        mockExecByCommand({
          'gemini --version': { stdout: 'gemini 1.2.3\n' },
        })

        const result = await detectCliTool(GEMINI_CLI, 'C:\\project')

        expect(result.version).toBe('1.2.3')
      })

      it('should handle version with only major.minor', async () => {
        mockExecByCommand({
          'codex --version': { stdout: 'codex version 3.1\n' },
        })

        const result = await detectCliTool(CODEX_CLI, 'C:\\project')

        expect(result.version).toBe('3.1')
      })

      it('should handle multiple paths in where output (Windows)', async () => {
        mockExecByCommand({
          'claude --version': { error: 'not recognized' },
          'where claude': {
            stdout: 'C:\\Users\\user\\bin\\claude.exe\nC:\\Program Files\\claude\\claude.exe\n',
          },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.path).toBe('C:\\Users\\user\\bin\\claude.exe')
      })
    })

    describe('Local Unix context (Linux/macOS)', () => {
      beforeEach(() => {
        setPlatform('linux')
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-unix')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'unix',
          original: '/home/user/project',
          normalized: '/home/user/project',
          isAbsolute: true,
        })
      })

      it('should detect installed tool on Unix', async () => {
        mockExecByCommand({
          'claude --version': { stdout: 'claude v1.5.0\n' },
          'which claude': { stdout: '/usr/local/bin/claude\n' },
        })

        const result = await detectCliTool(CLAUDE_CLI, '/home/user/project')

        expect(result.installed).toBe(true)
        expect(result.version).toBe('1.5.0')
        expect(result.path).toBe('/usr/local/bin/claude')
      })

      it('should use which instead of where on Unix', async () => {
        mockExecByCommand({
          'gemini --version': { error: 'command not found' },
          'which gemini': { stdout: '/usr/bin/gemini\n' },
        })

        const result = await detectCliTool(GEMINI_CLI, '/home/user/project')

        expect(result.installed).toBe(true)
        expect(result.path).toBe('/usr/bin/gemini')
      })

      it('should handle command not found error', async () => {
        mockExecByCommand({
          'codex --version': { error: 'command not found' },
          'which codex': { error: 'command not found' },
        })

        const result = await detectCliTool(CODEX_CLI, '/home/user/project')

        expect(result.installed).toBe(false)
      })
    })

    describe('SSH context', () => {
      const mockSshManager = {
        getProjectMasterStatus: vi.fn(),
        execViaProjectMaster: vi.fn(),
      }

      beforeEach(() => {
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('ssh-remote')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'unix',
          original: '/remote/project',
          normalized: '/remote/project',
          isAbsolute: true,
        })
        mockSshManager.getProjectMasterStatus.mockReset()
        mockSshManager.execViaProjectMaster.mockReset()
      })

      it('should detect tool via SSH when connected', async () => {
        mockSshManager.getProjectMasterStatus.mockResolvedValue({ connected: true })
        mockSshManager.execViaProjectMaster
          .mockResolvedValueOnce('claude version 2.0.0\n')
          .mockResolvedValueOnce('/home/remote/bin/claude\n')

        const result = await detectCliTool(
          CLAUDE_CLI,
          '/remote/project',
          'project-123',
          mockSshManager
        )

        expect(result.installed).toBe(true)
        expect(result.version).toBe('2.0.0')
        expect(result.path).toBe('/home/remote/bin/claude')
      })

      it('should return not installed when SSH not connected', async () => {
        mockSshManager.getProjectMasterStatus.mockResolvedValue({ connected: false })

        const result = await detectCliTool(
          CLAUDE_CLI,
          '/remote/project',
          'project-123',
          mockSshManager
        )

        // When SSH is not connected, detection fails gracefully
        expect(result.installed).toBe(false)
      })

      it('should return not installed when SSH manager not provided', async () => {
        const result = await detectCliTool(CLAUDE_CLI, '/remote/project', 'project-123')

        // When SSH manager is not provided for SSH context, detection fails gracefully
        expect(result.installed).toBe(false)
      })

      it('should handle SSH command failure as not installed', async () => {
        mockSshManager.getProjectMasterStatus.mockResolvedValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockRejectedValue(new Error('SSH timeout'))

        const result = await detectCliTool(
          CLAUDE_CLI,
          '/remote/project',
          'project-123',
          mockSshManager
        )

        // SSH errors during version check are treated as "tool not installed"
        expect(result.installed).toBe(false)
      })

      it('should detect tool not installed via SSH', async () => {
        mockSshManager.getProjectMasterStatus.mockResolvedValue({ connected: true })
        mockSshManager.execViaProjectMaster
          .mockRejectedValueOnce(new Error('command not found'))
          .mockRejectedValueOnce(new Error('command not found'))

        const result = await detectCliTool(
          CLAUDE_CLI,
          '/remote/project',
          'project-123',
          mockSshManager
        )

        expect(result.installed).toBe(false)
      })
    })

    describe('Error handling', () => {
      beforeEach(() => {
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-unix')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'unix',
          original: '/project',
          normalized: '/project',
          isAbsolute: true,
        })
      })

      it('should treat timeout errors as not installed', async () => {
        ;(exec as unknown as ExecMock).mockImplementation((_cmd, _opts, callback) => {
          if (typeof callback === 'function') {
            const error = new Error('ETIMEDOUT') as Error & { code?: string }
            error.code = 'ETIMEDOUT'
            callback(error)
          }
        })

        const result = await detectCliTool(CLAUDE_CLI, '/project')

        // Timeout errors during detection are treated as "not installed"
        // since we can't determine if the tool exists
        expect(result.installed).toBe(false)
      })

      it('should treat permission errors as not installed', async () => {
        ;(exec as unknown as ExecMock).mockImplementation((_cmd, _opts, callback) => {
          if (typeof callback === 'function') {
            const error = new Error('EACCES: permission denied')
            callback(error)
          }
        })

        const result = await detectCliTool(CLAUDE_CLI, '/project')

        // Permission errors are treated as "not installed" since we can't verify
        expect(result.installed).toBe(false)
      })

      it('should handle ENOENT errors as command not found', async () => {
        mockExecByCommand({
          'claude --version': { error: 'ENOENT' },
          'which claude': { error: 'ENOENT' },
        })

        const result = await detectCliTool(CLAUDE_CLI, '/project')

        expect(result.installed).toBe(false)
        expect(result.error).toBeUndefined() // ENOENT is treated as not installed, not an error
      })
    })
  })

  describe('detectAllCliTools', () => {
    beforeEach(() => {
      vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-unix')
      vi.mocked(PathService.analyzePath).mockReturnValue({
        type: 'unix',
        original: '/project',
        normalized: '/project',
        isAbsolute: true,
      })
    })

    it('should detect all built-in tools', async () => {
      mockExecByCommand({
        'claude --version': { stdout: 'claude v1.0.0\n' },
        'gemini --version': { stdout: 'gemini v2.0.0\n' },
        'codex --version': { error: 'not found' },
        'which claude': { stdout: '/usr/bin/claude\n' },
        'which gemini': { stdout: '/usr/bin/gemini\n' },
        'which codex': { error: 'not found' },
      })

      const result = await detectAllCliTools('/project')

      expect(result.success).toBe(true)
      expect(result.tools).toHaveLength(3)

      const claude = result.tools.find((t) => t.id === 'claude')
      expect(claude?.installed).toBe(true)
      expect(claude?.version).toBe('1.0.0')

      const gemini = result.tools.find((t) => t.id === 'gemini')
      expect(gemini?.installed).toBe(true)
      expect(gemini?.version).toBe('2.0.0')

      const codex = result.tools.find((t) => t.id === 'codex')
      expect(codex?.installed).toBe(false)
    })

    it('should include additional custom tools', async () => {
      const customTool: CliToolDefinition = {
        id: 'custom-ai',
        name: 'Custom AI CLI',
        versionCommands: ['custom-ai --version'],
        pathCommands: {
          windows: ['where custom-ai'],
          unix: ['which custom-ai'],
        },
        versionRegex: /v?(\d+\.\d+\.\d+)/,
      }

      mockExecByCommand({
        'claude --version': { error: 'not found' },
        'gemini --version': { error: 'not found' },
        'codex --version': { error: 'not found' },
        'custom-ai --version': { stdout: 'v3.0.0\n' },
        'which claude': { error: 'not found' },
        'which gemini': { error: 'not found' },
        'which codex': { error: 'not found' },
        'which custom-ai': { stdout: '/usr/local/bin/custom-ai\n' },
      })

      const result = await detectAllCliTools('/project', undefined, undefined, [customTool])

      expect(result.tools).toHaveLength(4)

      const custom = result.tools.find((t) => t.id === 'custom-ai')
      expect(custom?.installed).toBe(true)
      expect(custom?.version).toBe('3.0.0')
    })

    it('should run detections in parallel', async () => {
      let concurrentCalls = 0
      let maxConcurrent = 0

      ;(exec as unknown as ExecMock).mockImplementation((_cmd, _opts, callback) => {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)

        setTimeout(() => {
          concurrentCalls--
          if (typeof callback === 'function') {
            callback(new Error('not found'))
          }
        }, 10)
      })

      await detectAllCliTools('/project')

      // Should have at least 2 concurrent calls (3 tools = 3 version commands minimum)
      expect(maxConcurrent).toBeGreaterThanOrEqual(2)
    })

    it('should handle individual tool errors gracefully', async () => {
      // Mock to throw on getExecutionContext for each tool detection
      vi.mocked(PathService.getExecutionContext).mockRejectedValue(new Error('Path service failed'))

      const result = await detectAllCliTools('/project')

      // The overall detection should still succeed, but individual tools should have errors
      expect(result.success).toBe(true) // detectAllCliTools catches errors at tool level
      expect(result.tools).toHaveLength(3)
      // Each tool should have an error since getExecutionContext fails
      expect(result.tools.every((t) => !t.installed)).toBe(true)
      expect(result.tools.every((t) => t.error?.includes('Path service failed'))).toBe(true)
    })
  })

  describe('createCliToolDefinition', () => {
    it('should create a valid tool definition', () => {
      const tool = createCliToolDefinition('my-tool', 'My Tool', 'mytool')

      expect(tool.id).toBe('my-tool')
      expect(tool.name).toBe('My Tool')
      expect(tool.versionCommands).toContain('mytool --version')
      expect(tool.versionCommands).toContain('mytool -v')
      expect(tool.versionCommands).toContain('mytool version')
      expect(tool.pathCommands.windows).toContain('where mytool')
      expect(tool.pathCommands.unix).toContain('which mytool')
    })

    it('should use custom version regex when provided', () => {
      const customRegex = /version:\s*(\d+\.\d+)/
      const tool = createCliToolDefinition('my-tool', 'My Tool', 'mytool', customRegex)

      expect(tool.versionRegex).toBe(customRegex)
    })

    it('should use default version regex when not provided', () => {
      const tool = createCliToolDefinition('my-tool', 'My Tool', 'mytool')

      expect(tool.versionRegex.test('v1.2.3')).toBe(true)
      expect(tool.versionRegex.test('1.2.3')).toBe(true)
    })

    it('should create tool that works with detectCliTool', async () => {
      vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-unix')
      vi.mocked(PathService.analyzePath).mockReturnValue({
        type: 'unix',
        original: '/project',
        normalized: '/project',
        isAbsolute: true,
      })

      const tool = createCliToolDefinition('custom', 'Custom', 'custom-cli')

      mockExecByCommand({
        'custom-cli --version': { stdout: 'custom-cli version 4.5.6\n' },
        'which custom-cli': { stdout: '/usr/bin/custom-cli\n' },
      })

      const result = await detectCliTool(tool, '/project')

      expect(result.installed).toBe(true)
      expect(result.version).toBe('4.5.6')
      expect(result.path).toBe('/usr/bin/custom-cli')
    })
  })

  describe('Version regex patterns', () => {
    const testVersionExtraction = (regex: RegExp, input: string, expected: string | null) => {
      const match = input.match(regex)
      expect(match?.[1] ?? null).toBe(expected)
    }

    describe('CLAUDE_CLI version regex', () => {
      const regex = CLAUDE_CLI.versionRegex

      it('should match "claude v1.0.5"', () => {
        testVersionExtraction(regex, 'claude v1.0.5', '1.0.5')
      })

      it('should match "claude version 2.3.4"', () => {
        testVersionExtraction(regex, 'claude version 2.3.4', '2.3.4')
      })

      it('should match "version 1.0"', () => {
        testVersionExtraction(regex, 'version 1.0', '1.0')
      })

      it('should match version at start of line', () => {
        testVersionExtraction(regex, 'claude 1.2.3\nother stuff', '1.2.3')
      })
    })

    describe('GEMINI_CLI version regex', () => {
      const regex = GEMINI_CLI.versionRegex

      it('should match "gemini v1.0.0"', () => {
        testVersionExtraction(regex, 'gemini v1.0.0', '1.0.0')
      })

      it('should match "gemini version 0.5.2"', () => {
        testVersionExtraction(regex, 'gemini version 0.5.2', '0.5.2')
      })
    })

    describe('CODEX_CLI version regex', () => {
      const regex = CODEX_CLI.versionRegex

      it('should match "codex v1.0.0"', () => {
        testVersionExtraction(regex, 'codex v1.0.0', '1.0.0')
      })

      it('should match "codex version 2.1.0"', () => {
        testVersionExtraction(regex, 'codex version 2.1.0', '2.1.0')
      })
    })
  })

  describe('Platform-specific behavior', () => {
    describe('Windows', () => {
      beforeEach(() => {
        setPlatform('win32')
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-windows')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'windows',
          original: 'C:\\project',
          normalized: 'C:/project',
          isAbsolute: true,
        })
      })

      it('should use where command on Windows', async () => {
        let usedWhereCommand = false

        ;(exec as unknown as ExecMock).mockImplementation((cmd, _opts, callback) => {
          if (typeof callback === 'function') {
            const cmdStr = cmd as string
            if (cmdStr.includes('where')) {
              usedWhereCommand = true
              callback(null, { stdout: 'C:\\bin\\claude.exe\n', stderr: '' })
            } else {
              callback(new Error('not found'))
            }
          }
        })

        await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(usedWhereCommand).toBe(true)
      })

      it('should handle Windows-style "is not recognized" error', async () => {
        mockExecByCommand({
          'claude --version': { error: "'claude' is not recognized as an internal or external command" },
          'where claude': { error: "INFO: Could not find files for the given pattern(s)" },
        })

        const result = await detectCliTool(CLAUDE_CLI, 'C:\\project')

        expect(result.installed).toBe(false)
        expect(result.error).toBeUndefined()
      })
    })

    describe('macOS', () => {
      beforeEach(() => {
        setPlatform('darwin')
        vi.mocked(PathService.getExecutionContext).mockResolvedValue('local-unix')
        vi.mocked(PathService.analyzePath).mockReturnValue({
          type: 'unix',
          original: '/Users/user/project',
          normalized: '/Users/user/project',
          isAbsolute: true,
        })
      })

      it('should use which command on macOS', async () => {
        let usedWhichCommand = false

        ;(exec as unknown as ExecMock).mockImplementation((cmd, _opts, callback) => {
          if (typeof callback === 'function') {
            const cmdStr = cmd as string
            if (cmdStr.includes('which')) {
              usedWhichCommand = true
              callback(null, { stdout: '/usr/local/bin/claude\n', stderr: '' })
            } else {
              callback(new Error('not found'))
            }
          }
        })

        await detectCliTool(CLAUDE_CLI, '/Users/user/project')

        expect(usedWhichCommand).toBe(true)
      })

      it('should handle macOS-style "command not found" error', async () => {
        mockExecByCommand({
          'claude --version': { error: 'zsh: command not found: claude' },
          'which claude': { stdout: '' },
        })

        const result = await detectCliTool(CLAUDE_CLI, '/Users/user/project')

        expect(result.installed).toBe(false)
      })
    })
  })
})
