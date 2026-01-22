/**
 * Tests for WSL path detection and conversion utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ExecSyncOptions } from 'child_process'
import {
  detectWslPath,
  convertToWslUncPath,
  getDefaultWslDistro,
  getWslDistros,
  buildWslCommand,
  isWslEnvironment,
  type WslPathInfo,
} from '../utils/wsl-utils'

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

// Import execSync after mocking
import { execSync } from 'child_process'

describe('detectWslPath', () => {
  let originalPlatform: string

  beforeEach(() => {
    originalPlatform = process.platform
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  describe('Windows UNC paths (\\\\wsl$\\...)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should detect \\\\wsl$\\Ubuntu\\home\\user path', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/home/user',
      })
    })

    it('should detect \\\\wsl$\\Debian\\var\\log path', () => {
      const result = detectWslPath('\\\\wsl$\\Debian\\var\\log')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Debian',
        linuxPath: '/var/log',
      })
    })

    it('should handle path with no subdirectory (root)', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/',
      })
    })

    it('should handle case-insensitive wsl$ prefix', () => {
      const result = detectWslPath('\\\\WSL$\\Ubuntu\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/home/user',
      })
    })

    it('should handle distro names with hyphens', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu-22.04\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu-22.04',
        linuxPath: '/home/user',
      })
    })
  })

  describe('Windows localhost paths (\\\\wsl.localhost\\...)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should detect \\\\wsl.localhost\\Ubuntu\\home\\user path', () => {
      const result = detectWslPath('\\\\wsl.localhost\\Ubuntu\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/home/user',
      })
    })

    it('should detect \\\\wsl.localhost\\Debian\\etc\\nginx path', () => {
      const result = detectWslPath('\\\\wsl.localhost\\Debian\\etc\\nginx')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Debian',
        linuxPath: '/etc/nginx',
      })
    })

    it('should handle path with no subdirectory (root)', () => {
      const result = detectWslPath('\\\\wsl.localhost\\Ubuntu')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/',
      })
    })

    it('should handle case-insensitive wsl.localhost prefix', () => {
      const result = detectWslPath('\\\\WSL.LOCALHOST\\Ubuntu\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/home/user',
      })
    })
  })

  describe('Linux-style absolute paths on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should detect /home/user path on Windows', () => {
      const result = detectWslPath('/home/user')
      expect(result).toEqual({
        isWslPath: true,
        linuxPath: '/home/user',
      })
    })

    it('should detect /var/log path on Windows', () => {
      const result = detectWslPath('/var/log')
      expect(result).toEqual({
        isWslPath: true,
        linuxPath: '/var/log',
      })
    })

    it('should detect root / path on Windows', () => {
      const result = detectWslPath('/')
      expect(result).toEqual({
        isWslPath: true,
        linuxPath: '/',
      })
    })

    it('should NOT detect network paths starting with //', () => {
      const result = detectWslPath('//server/share')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should detect /mnt/c/ path on Windows', () => {
      const result = detectWslPath('/mnt/c/Users/test')
      expect(result).toEqual({
        isWslPath: true,
        linuxPath: '/mnt/c/Users/test',
      })
    })
  })

  describe('Regular Windows paths', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should NOT detect C:\\Users\\... as WSL path', () => {
      const result = detectWslPath('C:\\Users\\test\\Documents')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should NOT detect D:\\Projects\\... as WSL path', () => {
      const result = detectWslPath('D:\\Projects\\myproject')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should NOT detect relative Windows path', () => {
      const result = detectWslPath('folder\\subfolder')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should NOT detect network share paths', () => {
      const result = detectWslPath('\\\\server\\share\\folder')
      expect(result).toEqual({
        isWslPath: false,
      })
    })
  })

  describe('Non-Windows platform behavior', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })
    })

    it('should NOT detect /home/user as WSL path on Linux', () => {
      const result = detectWslPath('/home/user')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should NOT detect /var/log as WSL path on Linux', () => {
      const result = detectWslPath('/var/log')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should NOT detect root / as WSL path on Linux', () => {
      const result = detectWslPath('/')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should still detect UNC paths (even though unlikely on Linux)', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu',
        linuxPath: '/home/user',
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      const result = detectWslPath('')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should handle single backslash', () => {
      const result = detectWslPath('\\')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should handle whitespace', () => {
      const result = detectWslPath('   ')
      expect(result).toEqual({
        isWslPath: false,
      })
    })

    it('should handle path with spaces in distro name', () => {
      const result = detectWslPath('\\\\wsl$\\Ubuntu 22.04\\home\\user')
      expect(result).toEqual({
        isWslPath: true,
        distro: 'Ubuntu 22.04',
        linuxPath: '/home/user',
      })
    })
  })
})

describe('convertToWslUncPath', () => {
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

  describe('Convert with specified distro', () => {
    it('should convert /home/user with Ubuntu distro', () => {
      const result = convertToWslUncPath('/home/user', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
    })

    it('should convert /var/log with Debian distro', () => {
      const result = convertToWslUncPath('/var/log', 'Debian')
      expect(result).toBe('\\\\wsl$\\Debian\\var\\log')
    })

    it('should convert root / with specified distro', () => {
      const result = convertToWslUncPath('/', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\')
    })

    it('should convert /mnt/c/Users with specified distro', () => {
      const result = convertToWslUncPath('/mnt/c/Users', 'Ubuntu-22.04')
      expect(result).toBe('\\\\wsl$\\Ubuntu-22.04\\mnt\\c\\Users')
    })

    it('should handle deep paths', () => {
      const result = convertToWslUncPath('/home/user/projects/myapp/src/index.ts', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\projects\\myapp\\src\\index.ts')
    })
  })

  describe('Convert with default distro', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should use default distro when not specified', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n')
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
    })

    it('should use first distro from list as default', () => {
      vi.mocked(execSync).mockReturnValue('Debian\nUbuntu\n')
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('\\\\wsl$\\Debian\\home\\user')
    })

    it('should handle UTF-16 null bytes in distro name', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\0\n\0')
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
    })
  })

  describe('Behavior when no distro available', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return original path when no default distro', () => {
      vi.mocked(execSync).mockReturnValue('')
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('/home/user')
    })

    it('should return original path when execSync throws', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command failed')
      })
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('/home/user')
    })

    it('should return original path on non-Windows platform', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })
      const result = convertToWslUncPath('/home/user')
      expect(result).toBe('/home/user')
    })
  })

  describe('Various Linux path formats', () => {
    it('should handle path with no leading slash', () => {
      const result = convertToWslUncPath('home/user', 'Ubuntu')
      // Note: Function doesn't add leading slash - converts path as-is
      expect(result).toBe('\\\\wsl$\\Ubuntuhome\\user')
    })

    it('should handle path with multiple slashes', () => {
      const result = convertToWslUncPath('//home//user', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\\\home\\\\user')
    })

    it('should handle /tmp path', () => {
      const result = convertToWslUncPath('/tmp', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\tmp')
    })

    it('should handle /opt path', () => {
      const result = convertToWslUncPath('/opt/app', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\opt\\app')
    })
  })
})

describe('getDefaultWslDistro', () => {
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

  describe('Success cases', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return first distro when one is available', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n')
      const result = getDefaultWslDistro()
      expect(result).toBe('Ubuntu')
    })

    it('should return first distro from multiple', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\nDebian\nAlpine\n')
      const result = getDefaultWslDistro()
      expect(result).toBe('Ubuntu')
    })

    it('should handle distro names with versions', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu-22.04\n')
      const result = getDefaultWslDistro()
      expect(result).toBe('Ubuntu-22.04')
    })

    it('should trim whitespace from distro name', () => {
      vi.mocked(execSync).mockReturnValue('  Ubuntu  \n')
      const result = getDefaultWslDistro()
      expect(result).toBe('Ubuntu')
    })

    it('should handle UTF-16 null bytes', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\0\n\0Debian\0\n\0')
      const result = getDefaultWslDistro()
      expect(result).toBe('Ubuntu')
    })

    it('should call execSync with correct parameters', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n')
      getDefaultWslDistro()
      expect(execSync).toHaveBeenCalledWith('wsl -l -q', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    })
  })

  describe('No distros available', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return null when output is empty', () => {
      vi.mocked(execSync).mockReturnValue('')
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })

    it('should return null when output is only whitespace', () => {
      vi.mocked(execSync).mockReturnValue('   \n\n  ')
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })

    it('should return null when output is only null bytes', () => {
      vi.mocked(execSync).mockReturnValue('\0\0\0\n\0')
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })
  })

  describe('Non-Windows platform', () => {
    it('should return null on Linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
      expect(execSync).not.toHaveBeenCalled()
    })

    it('should return null on macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
      expect(execSync).not.toHaveBeenCalled()
    })
  })

  describe('Command execution failure', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return null when execSync throws Error', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command not found')
      })
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })

    it('should return null when execSync throws string', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw 'Command failed'
      })
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })

    it('should return null when wsl not installed', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('wsl is not recognized')
      })
      const result = getDefaultWslDistro()
      expect(result).toBeNull()
    })
  })
})

describe('getWslDistros', () => {
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

  describe('Success cases', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return array of single distro', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu'])
    })

    it('should return array of multiple distros', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\nDebian\nAlpine\n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu', 'Debian', 'Alpine'])
    })

    it('should handle distro names with versions', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu-22.04\nUbuntu-20.04\n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu-22.04', 'Ubuntu-20.04'])
    })

    it('should trim whitespace from each distro', () => {
      vi.mocked(execSync).mockReturnValue('  Ubuntu  \n  Debian  \n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu', 'Debian'])
    })

    it('should filter out empty lines', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n\n\nDebian\n\n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu', 'Debian'])
    })

    it('should call execSync with correct parameters', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\n')
      getWslDistros()
      expect(execSync).toHaveBeenCalledWith('wsl -l -q', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    })
  })

  describe('UTF-16 encoding cleanup', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should remove null bytes from output', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\0\n\0Debian\0\n\0')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu', 'Debian'])
    })

    it('should handle output with only null bytes', () => {
      vi.mocked(execSync).mockReturnValue('\0\0\0\n\0\n\0')
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should handle mixed null bytes and whitespace', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu\0 \n\0 Debian \0\n')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu', 'Debian'])
    })

    it('should handle distro names containing special characters', () => {
      vi.mocked(execSync).mockReturnValue('Ubuntu-22.04\0\n\0Alpine-3.18\0\n\0')
      const result = getWslDistros()
      expect(result).toEqual(['Ubuntu-22.04', 'Alpine-3.18'])
    })
  })

  describe('No distros available', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return empty array when output is empty', () => {
      vi.mocked(execSync).mockReturnValue('')
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should return empty array when output is only whitespace', () => {
      vi.mocked(execSync).mockReturnValue('   \n\n  ')
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should return empty array when output is only newlines', () => {
      vi.mocked(execSync).mockReturnValue('\n\n\n')
      const result = getWslDistros()
      expect(result).toEqual([])
    })
  })

  describe('Non-Windows platform', () => {
    it('should return empty array on Linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })
      const result = getWslDistros()
      expect(result).toEqual([])
      expect(execSync).not.toHaveBeenCalled()
    })

    it('should return empty array on macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })
      const result = getWslDistros()
      expect(result).toEqual([])
      expect(execSync).not.toHaveBeenCalled()
    })

    it('should return empty array on FreeBSD', () => {
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
        configurable: true,
      })
      const result = getWslDistros()
      expect(result).toEqual([])
      expect(execSync).not.toHaveBeenCalled()
    })
  })

  describe('Command execution failure', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })
    })

    it('should return empty array when execSync throws Error', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command not found')
      })
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should return empty array when execSync throws string', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw 'Command failed'
      })
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should return empty array when wsl not installed', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('wsl is not recognized')
      })
      const result = getWslDistros()
      expect(result).toEqual([])
    })

    it('should return empty array when access denied', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Access denied')
      })
      const result = getWslDistros()
      expect(result).toEqual([])
    })
  })
})

describe('buildWslCommand', () => {
  describe('With WSL path info', () => {
    it('should build correct WSL command with distro', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home/user' }
      const result = buildWslCommand('ls -la', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('wsl')
      expect(result.cmd).toContain('-d Ubuntu')
      expect(result.cmd).toContain('bash -c')
      expect(result.cmd).toContain("cd '/home/user'")
      expect(result.cmd).toContain('ls -la')
      expect(result.cwd).toBeUndefined()
    })

    it('should build WSL command without distro when not specified', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, linuxPath: '/home/user' }
      const result = buildWslCommand('ls -la', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('wsl ')
      expect(result.cmd).not.toContain('-d ')
      expect(result.cmd).toContain('bash -c')
      expect(result.cwd).toBeUndefined()
    })

    it('should escape double quotes in command', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home' }
      const result = buildWslCommand('echo "hello world"', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('\\"hello world\\"')
    })

    it('should escape multiple quotes in command', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home' }
      const result = buildWslCommand('git commit -m "fix: resolve \"bug\" issue"', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('git commit -m \\"fix: resolve \\"bug\\" issue\\"')
    })

    it('should use projectPath as fallback when linuxPath is not specified', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu' }
      const result = buildWslCommand('pwd', '/home/user', wslInfo)

      expect(result.cmd).toContain("cd '/home/user'")
    })

    it('should handle complex commands with pipes', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home/user' }
      const result = buildWslCommand('ls -la | grep "test"', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('ls -la | grep \\"test\\"')
    })

    it('should handle deep Linux paths', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home/user/projects/myapp/src' }
      const result = buildWslCommand('cat index.ts', 'C:\\path', wslInfo)

      expect(result.cmd).toContain("cd '/home/user/projects/myapp/src'")
    })
  })

  describe('With non-WSL path info', () => {
    it('should return original command for non-WSL paths', () => {
      const wslInfo: WslPathInfo = { isWslPath: false }
      const result = buildWslCommand('ls -la', 'C:\\Users\\test', wslInfo)

      expect(result.cmd).toBe('ls -la')
      expect(result.cwd).toBe('C:\\Users\\test')
    })

    it('should preserve command as-is for local execution', () => {
      const wslInfo: WslPathInfo = { isWslPath: false }
      const result = buildWslCommand('npm run build', 'D:\\Projects\\myapp', wslInfo)

      expect(result.cmd).toBe('npm run build')
      expect(result.cwd).toBe('D:\\Projects\\myapp')
    })

    it('should not modify quotes in non-WSL commands', () => {
      const wslInfo: WslPathInfo = { isWslPath: false }
      const result = buildWslCommand('git commit -m "test"', 'C:\\repo', wslInfo)

      expect(result.cmd).toBe('git commit -m "test"')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty command', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home' }
      const result = buildWslCommand('', 'C:\\path', wslInfo)

      expect(result.cmd).toContain('wsl')
      expect(result.cmd).toContain("cd '/home' && ")
    })

    it('should handle command with single quotes', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home' }
      const result = buildWslCommand("echo 'hello'", 'C:\\path', wslInfo)

      // Single quotes should not be escaped
      expect(result.cmd).toContain("echo 'hello'")
    })

    it('should handle path with spaces', () => {
      const wslInfo: WslPathInfo = { isWslPath: true, distro: 'Ubuntu', linuxPath: '/home/user/my project' }
      const result = buildWslCommand('ls', 'C:\\path', wslInfo)

      // Path is wrapped in single quotes, so spaces are safe
      expect(result.cmd).toContain("cd '/home/user/my project'")
    })
  })
})

describe('isWslEnvironment', () => {
  let originalPlatform: string

  beforeEach(() => {
    originalPlatform = process.platform
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  it('should return true on Windows', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    })
    expect(isWslEnvironment()).toBe(true)
  })

  it('should return false on Linux', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true,
      configurable: true,
    })
    expect(isWslEnvironment()).toBe(false)
  })

  it('should return false on macOS', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    })
    expect(isWslEnvironment()).toBe(false)
  })

  it('should return false on FreeBSD', () => {
    Object.defineProperty(process, 'platform', {
      value: 'freebsd',
      writable: true,
      configurable: true,
    })
    expect(isWslEnvironment()).toBe(false)
  })
})
