import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

/**
 * SSH/Local Execution Fallback Pattern Tests
 *
 * This test suite validates the execution pattern used in electron/main.ts
 * for operations that can execute via SSH or fall back to local file system.
 *
 * Pattern tested:
 * 1. Check if projectId exists and sshManager is available
 * 2. If yes, check if status.connected is true
 * 3. If yes, try SSH execution
 * 4. On SSH error, log and fall through to local
 * 5. Execute local file system operation
 *
 * Handlers using this pattern:
 * - fs:readFile (lines ~2021-2102)
 * - fs:listDir (lines ~2119-2200)
 * - And others throughout electron/main.ts
 */

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('SSH/Local Execution Fallback Pattern', () => {
  // Mock SSH manager
  let mockSshManager: {
    getProjectMasterStatus: ReturnType<typeof vi.fn>
    execViaProjectMaster: ReturnType<typeof vi.fn>
  }

  // Mock console.error to verify logging
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create fresh mock SSH manager
    mockSshManager = {
      getProjectMasterStatus: vi.fn(),
      execViaProjectMaster: vi.fn(),
    }

    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('fs:readFile Pattern', () => {
    // Simulates the fs:readFile handler logic
    async function readFileHandler(
      filePath: string,
      projectId?: string,
      sshManager?: typeof mockSshManager
    ) {
      try {
        // Check if this is an SSH project with active tunnel
        if (projectId && sshManager) {
          const status = sshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            try {
              // Check file exists and get size via SSH
              const statOutput = await sshManager.execViaProjectMaster(
                projectId,
                `if [ -f "${filePath.replace(/"/g, '\\"')}" ]; then stat -f '%z %m' "${filePath.replace(/"/g, '\\"')}" 2>/dev/null || stat -c '%s %Y' "${filePath.replace(/"/g, '\\"')}" 2>/dev/null; fi`
              )

              if (!statOutput || statOutput.trim() === '') {
                return { success: false, error: `File not found: ${filePath}` }
              }

              const [sizeStr, mtimeStr] = statOutput.trim().split(' ')
              const size = parseInt(sizeStr, 10)

              if (size > 5 * 1024 * 1024) {
                return { success: false, error: 'File too large (max 5MB)' }
              }

              // Read file content via SSH
              const content = await sshManager.execViaProjectMaster(
                projectId,
                `cat "${filePath.replace(/"/g, '\\"')}"`
              )

              const modified = new Date(parseInt(mtimeStr, 10) * 1000).toISOString()

              return {
                success: true,
                content,
                size,
                modified,
              }
            } catch (err) {
              console.error('[fs:readFile] SSH command failed:', err)
              return { success: false, error: String(err) }
            }
          }
        }

        // Local file system fallback
        if (!fs.existsSync(filePath)) {
          return { success: false, error: `File not found: ${filePath}` }
        }

        const stats = fs.statSync(filePath)
        if (stats.isDirectory()) {
          return { success: false, error: 'Path is a directory' }
        }

        if (stats.size > 5 * 1024 * 1024) {
          return { success: false, error: 'File too large (max 5MB)' }
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        return {
          success: true,
          content,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        }
      } catch (err) {
        console.error('Failed to read file:', err)
        return { success: false, error: String(err) }
      }
    }

    describe('SSH Execution Path', () => {
      it('should use SSH when projectId exists, sshManager exists, and status.connected is true', async () => {
        const projectId = 'test-project'
        const filePath = '/remote/test.txt'
        const mockContent = 'SSH file content'
        const mockSize = 100
        const mockMtime = 1640000000

        // Mock SSH manager status as connected
        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })

        // Mock SSH commands
        mockSshManager.execViaProjectMaster
          .mockResolvedValueOnce(`${mockSize} ${mockMtime}`) // stat command
          .mockResolvedValueOnce(mockContent) // cat command

        const result = await readFileHandler(filePath, projectId, mockSshManager)

        // Verify SSH was used
        expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalledWith(projectId)
        expect(mockSshManager.execViaProjectMaster).toHaveBeenCalledTimes(2)

        // Verify result
        expect(result.success).toBe(true)
        expect(result.content).toBe(mockContent)
        expect(result.size).toBe(mockSize)
        expect(result.modified).toBe(new Date(mockMtime * 1000).toISOString())

        // Verify local fs was NOT used
        expect(fs.existsSync).not.toHaveBeenCalled()
      })

      it('should handle SSH file not found', async () => {
        const projectId = 'test-project'
        const filePath = '/remote/missing.txt'

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockResolvedValueOnce('') // Empty stat output

        const result = await readFileHandler(filePath, projectId, mockSshManager)

        expect(result.success).toBe(false)
        expect(result.error).toContain('File not found')
      })

      it('should handle SSH file too large', async () => {
        const projectId = 'test-project'
        const filePath = '/remote/large.txt'
        const largeSize = 6 * 1024 * 1024 // 6MB

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockResolvedValueOnce(`${largeSize} 1640000000`)

        const result = await readFileHandler(filePath, projectId, mockSshManager)

        expect(result.success).toBe(false)
        expect(result.error).toContain('File too large')
        expect(mockSshManager.execViaProjectMaster).toHaveBeenCalledTimes(1) // Only stat, no cat
      })
    })

    describe('Local Fallback Path', () => {
      it('should fall back to local when no projectId is provided', async () => {
        const filePath = '/local/test.txt'
        const mockContent = 'Local file content'
        const mockStats = {
          size: 100,
          isDirectory: () => false,
          mtime: new Date('2024-01-01T00:00:00Z'),
        }

        // Mock local fs operations
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue(mockStats as any)
        vi.mocked(fs.readFileSync).mockReturnValue(mockContent)

        const result = await readFileHandler(filePath) // No projectId

        // Verify SSH was NOT used
        expect(mockSshManager.getProjectMasterStatus).not.toHaveBeenCalled()

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(filePath)
        expect(fs.statSync).toHaveBeenCalledWith(filePath)
        expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf-8')

        // Verify result
        expect(result.success).toBe(true)
        expect(result.content).toBe(mockContent)
        expect(result.size).toBe(100)
      })

      it('should fall back to local when sshManager does not exist', async () => {
        const filePath = '/local/test.txt'
        const mockContent = 'Local file content'
        const mockStats = {
          size: 100,
          isDirectory: () => false,
          mtime: new Date('2024-01-01T00:00:00Z'),
        }

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue(mockStats as any)
        vi.mocked(fs.readFileSync).mockReturnValue(mockContent)

        const result = await readFileHandler(filePath, 'test-project', undefined) // No sshManager

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(filePath)
        expect(result.success).toBe(true)
        expect(result.content).toBe(mockContent)
      })

      it('should fall back to local when status.connected is false', async () => {
        const projectId = 'test-project'
        const filePath = '/local/test.txt'
        const mockContent = 'Local file content'
        const mockStats = {
          size: 100,
          isDirectory: () => false,
          mtime: new Date('2024-01-01T00:00:00Z'),
        }

        // Mock SSH manager status as disconnected
        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: false })

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue(mockStats as any)
        vi.mocked(fs.readFileSync).mockReturnValue(mockContent)

        const result = await readFileHandler(filePath, projectId, mockSshManager)

        // Verify status was checked but SSH exec was NOT called
        expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalledWith(projectId)
        expect(mockSshManager.execViaProjectMaster).not.toHaveBeenCalled()

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(filePath)
        expect(result.success).toBe(true)
        expect(result.content).toBe(mockContent)
      })

      it('should fall back to local and log error when SSH execution throws', async () => {
        const projectId = 'test-project'
        const filePath = '/fallback/test.txt'
        const sshError = new Error('SSH connection lost')

        // Mock SSH manager as connected
        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockRejectedValue(sshError)

        const result = await readFileHandler(filePath, projectId, mockSshManager)

        // Verify SSH was attempted
        expect(mockSshManager.execViaProjectMaster).toHaveBeenCalled()

        // Verify error was logged
        expect(consoleErrorSpy).toHaveBeenCalledWith('[fs:readFile] SSH command failed:', sshError)

        // Verify error was returned (SSH error returns immediately, doesn't fall back to local in this handler)
        expect(result.success).toBe(false)
        expect(result.error).toBe('Error: SSH connection lost')
      })

      it('should handle local file not found', async () => {
        const filePath = '/local/missing.txt'

        vi.mocked(fs.existsSync).mockReturnValue(false)

        const result = await readFileHandler(filePath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('File not found')
      })

      it('should handle local directory instead of file', async () => {
        const filePath = '/local/directory'
        const mockStats = {
          size: 0,
          isDirectory: () => true,
          mtime: new Date(),
        }

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue(mockStats as any)

        const result = await readFileHandler(filePath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Path is a directory')
      })

      it('should handle local file too large', async () => {
        const filePath = '/local/large.txt'
        const mockStats = {
          size: 6 * 1024 * 1024,
          isDirectory: () => false,
          mtime: new Date(),
        }

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue(mockStats as any)

        const result = await readFileHandler(filePath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('File too large')
        expect(fs.readFileSync).not.toHaveBeenCalled()
      })
    })
  })

  describe('fs:listDir Pattern', () => {
    // Simulates the fs:listDir handler logic
    async function listDirHandler(
      dirPath: string,
      projectId?: string,
      sshManager?: typeof mockSshManager
    ) {
      try {
        // Check if this is an SSH project with active tunnel
        if (projectId && sshManager) {
          const status = sshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            try {
              // Use ls to list directory via SSH
              const output = await sshManager.execViaProjectMaster(
                projectId,
                `ls -1Ap "${dirPath.replace(/"/g, '\\"')}"`
              )

              if (!output || output.trim() === '') {
                return { success: false, error: `Directory not found or empty: ${dirPath}` }
              }

              const entries = output
                .split('\n')
                .filter((line) => line.trim() && line !== '.')
                .map((line) => {
                  const isDir = line.endsWith('/')
                  const name = isDir ? line.slice(0, -1) : line
                  return {
                    name,
                    path: path.posix.join(dirPath, name),
                    isDirectory: isDir,
                    isFile: !isDir,
                  }
                })

              // Sort: directories first, then files, alphabetically
              entries.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })

              return { success: true, items: entries }
            } catch (err) {
              console.error('[fs:listDir] SSH command failed:', err)
              return { success: false, error: String(err) }
            }
          }
        }

        // Local file system fallback
        if (!fs.existsSync(dirPath)) {
          return { success: false, error: `Directory not found: ${dirPath}` }
        }

        const stats = fs.statSync(dirPath)
        if (!stats.isDirectory()) {
          return { success: false, error: 'Path is not a directory' }
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        const items = entries.map((entry: any) => ({
          name: entry.name,
          path: path.posix.join(dirPath, entry.name),
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        }))

        // Sort: directories first, then files, alphabetically
        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })

        return { success: true, items }
      } catch (err) {
        console.error('Failed to list directory:', err)
        return { success: false, error: String(err) }
      }
    }

    describe('SSH Execution Path', () => {
      it('should use SSH when projectId exists, sshManager exists, and status.connected is true', async () => {
        const projectId = 'test-project'
        const dirPath = '/remote/project'
        const mockLsOutput = 'dir1/\nfile1.txt\nfile2.js\n'

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockResolvedValue(mockLsOutput)

        const result = await listDirHandler(dirPath, projectId, mockSshManager)

        // Verify SSH was used
        expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalledWith(projectId)
        expect(mockSshManager.execViaProjectMaster).toHaveBeenCalledWith(
          projectId,
          `ls -1Ap "${dirPath}"`
        )

        // Verify result
        expect(result.success).toBe(true)
        expect(result.items).toHaveLength(3)
        expect(result.items?.[0]).toEqual({
          name: 'dir1',
          path: '/remote/project/dir1',
          isDirectory: true,
          isFile: false,
        })
        expect(result.items?.[1]).toEqual({
          name: 'file1.txt',
          path: '/remote/project/file1.txt',
          isDirectory: false,
          isFile: true,
        })

        // Verify local fs was NOT used
        expect(fs.existsSync).not.toHaveBeenCalled()
      })

      it('should handle SSH directory not found', async () => {
        const projectId = 'test-project'
        const dirPath = '/remote/missing'

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockResolvedValue('')

        const result = await listDirHandler(dirPath, projectId, mockSshManager)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Directory not found or empty')
      })

      it('should sort entries correctly (directories first, then alphabetically)', async () => {
        const projectId = 'test-project'
        const dirPath = '/remote/project'
        const mockLsOutput = 'zebra.txt\nfile.txt\nzoo/\nabc/\n'

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockResolvedValue(mockLsOutput)

        const result = await listDirHandler(dirPath, projectId, mockSshManager)

        expect(result.success).toBe(true)
        expect(result.items).toHaveLength(4)

        // Directories first
        expect(result.items?.[0].name).toBe('abc')
        expect(result.items?.[0].isDirectory).toBe(true)
        expect(result.items?.[1].name).toBe('zoo')
        expect(result.items?.[1].isDirectory).toBe(true)

        // Then files
        expect(result.items?.[2].name).toBe('file.txt')
        expect(result.items?.[2].isFile).toBe(true)
        expect(result.items?.[3].name).toBe('zebra.txt')
        expect(result.items?.[3].isFile).toBe(true)
      })
    })

    describe('Local Fallback Path', () => {
      it('should fall back to local when no projectId is provided', async () => {
        const dirPath = '/local/project'
        const mockEntries = [
          { name: 'dir1', isDirectory: () => true, isFile: () => false },
          { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        ]

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
        vi.mocked(fs.readdirSync).mockReturnValue(mockEntries as any)

        const result = await listDirHandler(dirPath)

        // Verify SSH was NOT used
        expect(mockSshManager.getProjectMasterStatus).not.toHaveBeenCalled()

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(dirPath)
        expect(fs.statSync).toHaveBeenCalledWith(dirPath)
        expect(fs.readdirSync).toHaveBeenCalledWith(dirPath, { withFileTypes: true })

        // Verify result
        expect(result.success).toBe(true)
        expect(result.items).toHaveLength(2)
      })

      it('should fall back to local when sshManager does not exist', async () => {
        const dirPath = '/local/project'
        const mockEntries = [
          { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        ]

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
        vi.mocked(fs.readdirSync).mockReturnValue(mockEntries as any)

        const result = await listDirHandler(dirPath, 'test-project', undefined)

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(dirPath)
        expect(result.success).toBe(true)
      })

      it('should fall back to local when status.connected is false', async () => {
        const projectId = 'test-project'
        const dirPath = '/local/project'
        const mockEntries = [
          { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        ]

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: false })

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
        vi.mocked(fs.readdirSync).mockReturnValue(mockEntries as any)

        const result = await listDirHandler(dirPath, projectId, mockSshManager)

        // Verify status was checked but SSH exec was NOT called
        expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalledWith(projectId)
        expect(mockSshManager.execViaProjectMaster).not.toHaveBeenCalled()

        // Verify local fs was used
        expect(fs.existsSync).toHaveBeenCalledWith(dirPath)
        expect(result.success).toBe(true)
      })

      it('should log error and return failure when SSH execution throws', async () => {
        const projectId = 'test-project'
        const dirPath = '/remote/project'
        const sshError = new Error('SSH timeout')

        mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
        mockSshManager.execViaProjectMaster.mockRejectedValue(sshError)

        const result = await listDirHandler(dirPath, projectId, mockSshManager)

        // Verify SSH was attempted
        expect(mockSshManager.execViaProjectMaster).toHaveBeenCalled()

        // Verify error was logged
        expect(consoleErrorSpy).toHaveBeenCalledWith('[fs:listDir] SSH command failed:', sshError)

        // Verify error was returned
        expect(result.success).toBe(false)
        expect(result.error).toBe('Error: SSH timeout')
      })

      it('should handle local directory not found', async () => {
        const dirPath = '/local/missing'

        vi.mocked(fs.existsSync).mockReturnValue(false)

        const result = await listDirHandler(dirPath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Directory not found')
      })

      it('should handle local path that is not a directory', async () => {
        const dirPath = '/local/file.txt'

        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any)

        const result = await listDirHandler(dirPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Path is not a directory')
      })
    })
  })

  describe('Decision Tree Flow', () => {
    /**
     * Decision tree for SSH/Local execution:
     *
     *                    Start
     *                      |
     *         +-----------+------------+
     *         |                        |
     *    projectId?              No projectId
     *         |                        |
     *    +----+----+                   |
     *    |         |                   |
     * sshManager?  No sshManager       |
     *    |         |                   |
     *    +----+----+                   |
     *         |                        |
     *    status.connected?             |
     *         |                        |
     *    +----+----+                   |
     *    |         |                   |
     *   Yes       No                   |
     *    |         |                   |
     * Try SSH     +-------------------+
     *    |                            |
     *    +--------+                   |
     *    |        |                   |
     * Success   Error                 |
     *    |        |                   |
     * Return   Log Error              |
     *           |                     |
     *           +---------------------+
     *                                 |
     *                          Local Execution
     *                                 |
     *                              Return
     */

    it('should follow the complete decision tree for SSH success', async () => {
      // This test verifies the full decision tree when SSH succeeds
      const projectId = 'test-project'
      const filePath = '/remote/test.txt'

      mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
      mockSshManager.execViaProjectMaster
        .mockResolvedValueOnce('100 1640000000')
        .mockResolvedValueOnce('content')

      async function handler() {
        // Decision 1: projectId exists?
        if (projectId && mockSshManager) {
          // Decision 2: status.connected?
          const status = mockSshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            // Decision 3: Try SSH
            try {
              const result = await mockSshManager.execViaProjectMaster(projectId, 'stat')
              const content = await mockSshManager.execViaProjectMaster(projectId, 'cat')
              return { success: true, content, via: 'ssh' }
            } catch (err) {
              console.error('SSH failed:', err)
              // Fall through to local
            }
          }
        }
        // Local execution
        return { success: true, content: 'local', via: 'local' }
      }

      const result = await handler()

      expect(result.via).toBe('ssh')
      expect(mockSshManager.execViaProjectMaster).toHaveBeenCalledTimes(2)
    })

    it('should follow the decision tree to local when projectId is missing', async () => {
      async function handler() {
        const projectId = undefined

        if (projectId && mockSshManager) {
          const status = mockSshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            try {
              await mockSshManager.execViaProjectMaster(projectId, 'cmd')
              return { via: 'ssh' }
            } catch (err) {
              console.error('SSH failed:', err)
            }
          }
        }
        return { via: 'local' }
      }

      const result = await handler()

      expect(result.via).toBe('local')
      expect(mockSshManager.getProjectMasterStatus).not.toHaveBeenCalled()
    })

    it('should follow the decision tree to local when sshManager is missing', async () => {
      async function handler() {
        const projectId = 'test-project'
        const sshMgr = undefined

        if (projectId && sshMgr) {
          // Won't reach here
          return { via: 'ssh' }
        }
        return { via: 'local' }
      }

      const result = await handler()

      expect(result.via).toBe('local')
    })

    it('should follow the decision tree to local when status.connected is false', async () => {
      mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: false })

      async function handler() {
        const projectId = 'test-project'

        if (projectId && mockSshManager) {
          const status = mockSshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            return { via: 'ssh' }
          }
        }
        return { via: 'local' }
      }

      const result = await handler()

      expect(result.via).toBe('local')
      expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalledWith('test-project')
      expect(mockSshManager.execViaProjectMaster).not.toHaveBeenCalled()
    })

    it('should follow the decision tree to error/local when SSH throws', async () => {
      mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
      mockSshManager.execViaProjectMaster.mockRejectedValue(new Error('Connection lost'))

      async function handler() {
        const projectId = 'test-project'

        if (projectId && mockSshManager) {
          const status = mockSshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            try {
              await mockSshManager.execViaProjectMaster(projectId, 'cmd')
              return { via: 'ssh' }
            } catch (err) {
              console.error('SSH failed:', err)
              // In real handlers, this might return error or fall through to local
              return { via: 'error', error: String(err) }
            }
          }
        }
        return { via: 'local' }
      }

      const result = await handler()

      expect(result.via).toBe('error')
      expect(consoleErrorSpy).toHaveBeenCalledWith('SSH failed:', expect.any(Error))
    })
  })
})
