/**
 * Tests for the centralized path handling service
 */

import {
  getEnvironment,
  clearEnvironmentCache,
  analyzePath,
  toGitPath,
  toFsPath,
  toWslUncPath,
  toWslLinuxPath,
  toDisplayPath,
  toSshPath,
  join,
  joinPosix,
  dirname,
  basename,
  extname,
  relative,
  normalize,
  escapeForBash,
  escapeForCmd,
  escapeForPowerShell,
  isWslPath,
  isWindowsPath,
  isAbsolutePath,
  isSamePath,
  isSubPath,
  PathService,
  PathInfo,
} from '../path-service'

describe('path-service', () => {
  beforeEach(() => {
    clearEnvironmentCache()
  })

  describe('getEnvironment', () => {
    it('returns platform information', () => {
      const env = getEnvironment()
      expect(env.platform).toBeDefined()
      expect(typeof env.isWindows).toBe('boolean')
      expect(typeof env.isMac).toBe('boolean')
      expect(typeof env.isLinux).toBe('boolean')
    })

    it('caches environment information', () => {
      const env1 = getEnvironment()
      const env2 = getEnvironment()
      expect(env1).toBe(env2) // Same reference
    })

    it('clearEnvironmentCache resets the cache', () => {
      const env1 = getEnvironment()
      clearEnvironmentCache()
      const env2 = getEnvironment()
      expect(env1).not.toBe(env2) // Different reference
    })
  })

  describe('analyzePath', () => {
    describe('Windows paths', () => {
      it('detects Windows drive paths', () => {
        const info = analyzePath('C:\\Users\\foo\\project')
        expect(info.type).toBe('windows')
        expect(info.normalized).toBe('C:/Users/foo/project')
        expect(info.isAbsolute).toBe(true)
      })

      it('handles forward slashes in Windows paths', () => {
        const info = analyzePath('C:/Users/foo/project')
        expect(info.type).toBe('windows')
        expect(info.normalized).toBe('C:/Users/foo/project')
        expect(info.isAbsolute).toBe(true)
      })

      it('handles mixed separators', () => {
        const info = analyzePath('C:/Users\\foo/project\\src')
        expect(info.type).toBe('windows')
        expect(info.normalized).toBe('C:/Users/foo/project/src')
      })
    })

    describe('WSL UNC paths', () => {
      it('detects \\\\wsl$ paths', () => {
        const info = analyzePath('\\\\wsl$\\Ubuntu\\home\\user\\project')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Ubuntu')
        expect(info.linuxPath).toBe('/home/user/project')
        expect(info.normalized).toBe('/home/user/project')
        expect(info.isAbsolute).toBe(true)
      })

      it('detects \\\\wsl.localhost paths', () => {
        const info = analyzePath('\\\\wsl.localhost\\Debian\\home\\user')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Debian')
        expect(info.linuxPath).toBe('/home/user')
      })

      it('handles root WSL paths', () => {
        const info = analyzePath('\\\\wsl$\\Ubuntu')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Ubuntu')
        expect(info.linuxPath).toBe('/')
      })

      it('detects mangled WSL paths with forward slashes (/wsl.localhost/...)', () => {
        const info = analyzePath('/wsl.localhost/Ubuntu/home/user/project')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Ubuntu')
        expect(info.linuxPath).toBe('/home/user/project')
        expect(info.normalized).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project')
      })

      it('detects mangled WSL paths with /wsl$/', () => {
        const info = analyzePath('/wsl$/Debian/home/user')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Debian')
        expect(info.linuxPath).toBe('/home/user')
      })

      it('handles mangled WSL root path', () => {
        const info = analyzePath('/wsl.localhost/Ubuntu')
        expect(info.type).toBe('wsl-unc')
        expect(info.wslDistro).toBe('Ubuntu')
        expect(info.linuxPath).toBe('/')
      })
    })

    describe('SSH remote paths', () => {
      it('detects user@host:path format', () => {
        const info = analyzePath('user@server:/home/user/project')
        expect(info.type).toBe('ssh-remote')
        expect(info.sshHost).toBe('server')
        expect(info.remotePath).toBe('/home/user/project')
        expect(info.isAbsolute).toBe(true)
      })

      it('detects host:path format', () => {
        const info = analyzePath('server:/home/user/project')
        expect(info.type).toBe('ssh-remote')
        expect(info.sshHost).toBe('server')
        expect(info.remotePath).toBe('/home/user/project')
      })

      it('handles relative SSH paths', () => {
        const info = analyzePath('user@server:project/src')
        expect(info.type).toBe('ssh-remote')
        expect(info.remotePath).toBe('project/src')
        expect(info.isAbsolute).toBe(false)
      })
    })

    describe('Unix paths', () => {
      it('detects absolute Unix paths', () => {
        const info = analyzePath('/home/user/project')
        // On Windows with WSL available, /home paths are detected as wsl-linux
        // On Linux/macOS, they're detected as unix
        const env = getEnvironment()
        if (env.isWindows && env.wslAvailable) {
          expect(info.type).toBe('wsl-linux')
          expect(info.linuxPath).toBe('/home/user/project')
        } else {
          expect(info.type).toBe('unix')
        }
        expect(info.normalized).toBe('/home/user/project')
        expect(info.isAbsolute).toBe(true)
      })

      it('does NOT treat macOS paths as WSL on any platform', () => {
        const macPaths = [
          '/Users/foo/project',
          '/Applications/App.app',
          '/Library/Preferences',
          '/System/Library',
          '/Volumes/External',
          '/private/var',
        ]

        for (const p of macPaths) {
          const info = analyzePath(p)
          // Should be unix, not wsl-linux
          expect(info.type).toBe('unix')
          expect(info.isAbsolute).toBe(true)
        }
      })
    })

    describe('Relative paths', () => {
      it('detects relative paths', () => {
        const info = analyzePath('src/components/App.tsx')
        expect(info.type).toBe('unix')
        expect(info.isAbsolute).toBe(false)
      })

      it('handles ./ prefix', () => {
        const info = analyzePath('./relative/path')
        expect(info.type).toBe('unix')
        expect(info.isAbsolute).toBe(false)
      })

      it('handles home directory paths', () => {
        const info = analyzePath('~/project')
        expect(info.type).toBe('unix')
        expect(info.isAbsolute).toBe(false) // ~ is expanded at runtime
      })
    })

    describe('Edge cases', () => {
      it('handles empty string', () => {
        const info = analyzePath('')
        expect(info.original).toBe('')
        expect(info.normalized).toBe('')
        expect(info.isAbsolute).toBe(false)
      })

      it('normalizes backslashes to forward slashes', () => {
        const info = analyzePath('src\\utils\\file.ts')
        expect(info.normalized).toBe('src/utils/file.ts')
      })
    })
  })

  describe('toGitPath', () => {
    it('converts backslashes to forward slashes', () => {
      expect(toGitPath('src\\utils\\file.ts')).toBe('src/utils/file.ts')
    })

    it('extracts Linux path from WSL UNC', () => {
      expect(toGitPath('\\\\wsl$\\Ubuntu\\home\\user\\file.ts')).toBe('/home/user/file.ts')
    })

    it('normalizes Windows paths', () => {
      expect(toGitPath('C:\\Users\\foo\\project\\src\\file.ts')).toBe('C:/Users/foo/project/src/file.ts')
    })

    it('passes through Unix paths', () => {
      expect(toGitPath('/home/user/file.ts')).toBe('/home/user/file.ts')
    })

    it('handles mangled WSL paths with forward slashes', () => {
      expect(toGitPath('/wsl.localhost/Ubuntu/home/user/file.ts')).toBe('/home/user/file.ts')
    })
  })

  describe('toFsPath', () => {
    it('handles mangled WSL paths (forward slashes)', () => {
      // This is the key bug fix - paths like /wsl.localhost/Ubuntu/... should convert to UNC
      const result = toFsPath('/wsl.localhost/Ubuntu/home/user/project')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project')
    })

    it('handles mangled WSL paths with /wsl$/', () => {
      const result = toFsPath('/wsl$/Ubuntu/home/user/project')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project')
    })

    it('passes through proper WSL UNC paths', () => {
      const result = toFsPath('\\\\wsl$\\Ubuntu\\home\\user\\project')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project')
    })

    it('handles Windows paths', () => {
      const result = toFsPath('C:\\Users\\foo\\project')
      expect(result).toBe('C:\\Users\\foo\\project')
    })
  })

  describe('toWslUncPath', () => {
    it('converts Linux path to UNC', () => {
      const result = toWslUncPath('/home/user/project', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project')
    })

    it('handles paths without leading slash', () => {
      const result = toWslUncPath('home/user', 'Ubuntu')
      expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
    })
  })

  describe('toWslLinuxPath', () => {
    it('extracts Linux path from UNC', () => {
      expect(toWslLinuxPath('\\\\wsl$\\Ubuntu\\home\\user\\project')).toBe('/home/user/project')
    })

    it('passes through Linux paths', () => {
      expect(toWslLinuxPath('/home/user/project')).toBe('/home/user/project')
    })
  })

  describe('toDisplayPath', () => {
    it('formats WSL UNC paths nicely', () => {
      expect(toDisplayPath('\\\\wsl$\\Ubuntu\\home\\user\\project')).toBe('WSL:Ubuntu:/home/user/project')
    })

    it('formats SSH paths nicely', () => {
      expect(toDisplayPath('user@server:/home/user')).toBe('SSH:server:/home/user')
    })

    it('normalizes Windows paths', () => {
      expect(toDisplayPath('C:\\Users\\foo\\project')).toBe('C:/Users/foo/project')
    })
  })

  describe('Path Manipulation', () => {
    describe('joinPosix', () => {
      it('joins with forward slashes', () => {
        expect(joinPosix('src', 'components', 'App.tsx')).toBe('src/components/App.tsx')
      })

      it('normalizes backslashes in input', () => {
        expect(joinPosix('src\\utils', 'file.ts')).toBe('src/utils/file.ts')
      })

      it('handles absolute paths', () => {
        expect(joinPosix('/home/user', 'project', 'src')).toBe('/home/user/project/src')
      })
    })

    describe('dirname', () => {
      it('gets directory from Unix path', () => {
        expect(dirname('/home/user/project/file.ts')).toBe('/home/user/project')
      })

      it('gets directory from WSL UNC path', () => {
        const result = dirname('\\\\wsl$\\Ubuntu\\home\\user\\file.ts')
        expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
      })
    })

    describe('basename', () => {
      it('gets filename from Unix path', () => {
        expect(basename('/home/user/project/file.ts')).toBe('file.ts')
      })

      it('gets filename from Windows path', () => {
        expect(basename('C:\\Users\\foo\\document.pdf')).toBe('document.pdf')
      })

      it('gets filename from WSL UNC path', () => {
        expect(basename('\\\\wsl$\\Ubuntu\\home\\user\\file.ts')).toBe('file.ts')
      })
    })

    describe('extname', () => {
      it('gets extension from path', () => {
        expect(extname('/home/user/file.ts')).toBe('.ts')
        expect(extname('document.pdf')).toBe('.pdf')
        expect(extname('no-extension')).toBe('')
      })
    })

    describe('relative', () => {
      it('gets relative path between two paths', () => {
        expect(relative('/home/user/project', '/home/user/project/src/file.ts')).toBe('src/file.ts')
      })
    })

    describe('normalize', () => {
      it('cleans up path separators', () => {
        expect(normalize('src//components/../utils/file.ts')).toBe('src/utils/file.ts')
      })
    })
  })

  describe('Command Escaping', () => {
    describe('escapeForBash', () => {
      it('wraps path in single quotes', () => {
        expect(escapeForBash('/home/user/my project')).toBe("'/home/user/my project'")
      })

      it('escapes internal single quotes', () => {
        expect(escapeForBash("/home/user/it's a file")).toBe("'/home/user/it'\\''s a file'")
      })
    })

    describe('escapeForCmd', () => {
      it('wraps path in double quotes', () => {
        expect(escapeForCmd('C:\\Users\\my folder\\file.txt')).toBe('"C:\\Users\\my folder\\file.txt"')
      })

      it('escapes special characters', () => {
        expect(escapeForCmd('C:\\test&file.txt')).toBe('"C:\\test^&file.txt"')
      })
    })

    describe('escapeForPowerShell', () => {
      it('wraps path in single quotes', () => {
        expect(escapeForPowerShell('C:\\Users\\my project')).toBe("'C:\\Users\\my project'")
      })

      it('escapes internal single quotes by doubling', () => {
        expect(escapeForPowerShell("C:\\Users\\it's a file")).toBe("'C:\\Users\\it''s a file'")
      })
    })
  })

  describe('Validation', () => {
    describe('isWslPath', () => {
      it('returns true for WSL UNC paths', () => {
        expect(isWslPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true)
        expect(isWslPath('\\\\wsl.localhost\\Debian\\home')).toBe(true)
      })

      it('returns false for Windows paths', () => {
        expect(isWslPath('C:\\Users\\foo')).toBe(false)
      })

      it('returns false for macOS paths', () => {
        expect(isWslPath('/Users/foo')).toBe(false)
      })
    })

    describe('isWindowsPath', () => {
      it('returns true for Windows drive paths', () => {
        expect(isWindowsPath('C:\\Users\\foo')).toBe(true)
        expect(isWindowsPath('D:/Projects')).toBe(true)
      })

      it('returns false for Unix paths', () => {
        expect(isWindowsPath('/home/user')).toBe(false)
      })
    })

    describe('isAbsolutePath', () => {
      it('returns true for absolute paths', () => {
        expect(isAbsolutePath('/home/user')).toBe(true)
        expect(isAbsolutePath('C:\\Users\\foo')).toBe(true)
        expect(isAbsolutePath('\\\\wsl$\\Ubuntu\\home')).toBe(true)
      })

      it('returns false for relative paths', () => {
        expect(isAbsolutePath('src/file.ts')).toBe(false)
        expect(isAbsolutePath('./relative')).toBe(false)
        expect(isAbsolutePath('~/home')).toBe(false)
      })
    })

    describe('isSamePath', () => {
      it('returns true for equivalent paths', () => {
        expect(isSamePath('/home/user/project', '/home/user/project/')).toBe(true)
        expect(isSamePath('C:\\Users\\foo', 'C:/Users/foo')).toBe(true)
      })

      it('returns false for different paths', () => {
        expect(isSamePath('/home/user', '/home/other')).toBe(false)
      })

      it('is case-insensitive', () => {
        expect(isSamePath('C:\\Users\\Foo', 'c:/users/foo')).toBe(true)
      })
    })

    describe('isSubPath', () => {
      it('returns true when child is under parent', () => {
        expect(isSubPath('/home/user', '/home/user/project/file.ts')).toBe(true)
        expect(isSubPath('/home/user/', '/home/user/project')).toBe(true)
      })

      it('returns true when paths are the same', () => {
        expect(isSubPath('/home/user', '/home/user')).toBe(true)
      })

      it('returns false when child is not under parent', () => {
        expect(isSubPath('/home/user', '/home/other')).toBe(false)
        expect(isSubPath('/home/user/project', '/home/user')).toBe(false)
      })
    })
  })

  describe('PathService namespace', () => {
    it('exports all functions', () => {
      expect(PathService.getEnvironment).toBe(getEnvironment)
      expect(PathService.analyzePath).toBe(analyzePath)
      expect(PathService.toGitPath).toBe(toGitPath)
      expect(PathService.toFsPath).toBe(toFsPath)
      expect(PathService.toWslUncPath).toBe(toWslUncPath)
      expect(PathService.toWslLinuxPath).toBe(toWslLinuxPath)
      expect(PathService.toDisplayPath).toBe(toDisplayPath)
      expect(PathService.toSshPath).toBe(toSshPath)
      expect(PathService.join).toBe(join)
      expect(PathService.joinPosix).toBe(joinPosix)
      expect(PathService.dirname).toBe(dirname)
      expect(PathService.basename).toBe(basename)
      expect(PathService.extname).toBe(extname)
      expect(PathService.relative).toBe(relative)
      expect(PathService.normalize).toBe(normalize)
      expect(PathService.escapeForBash).toBe(escapeForBash)
      expect(PathService.escapeForCmd).toBe(escapeForCmd)
      expect(PathService.escapeForPowerShell).toBe(escapeForPowerShell)
      expect(PathService.isWslPath).toBe(isWslPath)
      expect(PathService.isWindowsPath).toBe(isWindowsPath)
      expect(PathService.isAbsolutePath).toBe(isAbsolutePath)
      expect(PathService.isSamePath).toBe(isSamePath)
      expect(PathService.isSubPath).toBe(isSubPath)
    })
  })
})
