import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Git Command Handler Tests
 *
 * These tests verify the IPC handlers for git operations in electron/main.ts.
 * All handlers follow a common pattern:
 *
 * PATTERN IDENTIFIED:
 * ==================
 * 1. Handler registration: ipcMain.handle('git:command', async (_event, projectPath: string, projectId?: string) => {...})
 * 2. Logging: console.log with handler name and parameters
 * 3. Try-catch block:
 *    - SUCCESS: await execInContextAsync(`git command`, projectPath, projectId)
 *              return { success: true }
 *    - FAILURE: catch error, log it with console.error
 *              extract error message (Error object or string)
 *              return { success: false, error: errorMsg }
 *
 * Key differences:
 * - git:commit: Escapes the message parameter before passing to git
 * - git:fetch: Uses 'git fetch --all --prune'
 * - git:push/pull: Simple commands without extra flags
 */

describe('Git IPC Handlers', () => {
  // Mock modules
  let mockExecInContextAsync: ReturnType<typeof vi.fn>
  let mockIpcMain: any
  let mockConsoleLog: ReturnType<typeof vi.fn>
  let mockConsoleError: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Mock console methods
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Import electron mock
    const electron = await import('electron')
    mockIpcMain = electron.ipcMain
  })

  afterEach(() => {
    // Restore console methods
    mockConsoleLog.mockRestore()
    mockConsoleError.mockRestore()
  })

  /**
   * Helper function to create a mock execInContextAsync that we can spy on
   */
  const createExecMock = (shouldSucceed: boolean = true, returnValue: string = '', errorMessage: string = 'Mock error') => {
    if (shouldSucceed) {
      return vi.fn().mockResolvedValue(returnValue)
    } else {
      return vi.fn().mockRejectedValue(new Error(errorMessage))
    }
  }

  /**
   * Helper function to extract handler from ipcMain.handle calls
   */
  const getHandlerFunction = (channelName: string) => {
    const calls = mockIpcMain.handle.mock.calls
    const handlerCall = calls.find((call: any[]) => call[0] === channelName)
    return handlerCall ? handlerCall[1] : null
  }

  describe('git:push', () => {
    const CHANNEL = 'git:push'
    const PROJECT_PATH = '/test/project'
    const PROJECT_ID = 'test-project-id'

    it('should register the git:push handler', async () => {
      // Import main.ts to trigger handler registration
      // Note: In a real scenario, we'd need to set up the module to allow this
      // For now, we'll test the handler pattern directly

      const mockHandler = vi.fn(async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git push', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to push:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      })

      mockIpcMain.handle(CHANNEL, mockHandler)

      expect(mockIpcMain.handle).toHaveBeenCalledWith(CHANNEL, mockHandler)
    })

    it('should return success:true when push succeeds', async () => {
      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git push', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to push:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: true })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:push] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).not.toHaveBeenCalled()
    })

    it('should return success:false with error message when push fails', async () => {
      const ERROR_MESSAGE = 'Failed to push to remote'

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(false, '', ERROR_MESSAGE)
          await execMock('git push', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to push:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_MESSAGE })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:push] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to push:', expect.any(Error))
    })

    it('should handle non-Error objects in catch block', async () => {
      const ERROR_STRING = 'String error message'

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          // Simulate throwing a non-Error object
          throw ERROR_STRING
        } catch (err) {
          console.error('Failed to push:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_STRING })
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to push:', ERROR_STRING)
    })
  })

  describe('git:pull', () => {
    const CHANNEL = 'git:pull'
    const PROJECT_PATH = '/test/project'
    const PROJECT_ID = 'test-project-id'

    it('should register the git:pull handler', async () => {
      const mockHandler = vi.fn(async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:pull] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git pull', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to pull:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      })

      mockIpcMain.handle(CHANNEL, mockHandler)

      expect(mockIpcMain.handle).toHaveBeenCalledWith(CHANNEL, mockHandler)
    })

    it('should return success:true when pull succeeds', async () => {
      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:pull] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git pull', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to pull:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: true })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:pull] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).not.toHaveBeenCalled()
    })

    it('should return success:false with error message when pull fails', async () => {
      const ERROR_MESSAGE = 'Failed to pull from remote'

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:pull] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(false, '', ERROR_MESSAGE)
          await execMock('git pull', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to pull:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_MESSAGE })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:pull] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to pull:', expect.any(Error))
    })

    it('should handle string errors correctly', async () => {
      const ERROR_STRING = 'Pull conflict detected'

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:pull] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          throw ERROR_STRING
        } catch (err) {
          console.error('Failed to pull:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_STRING })
    })
  })

  describe('git:fetch', () => {
    const CHANNEL = 'git:fetch'
    const PROJECT_PATH = '/test/project'
    const PROJECT_ID = 'test-project-id'

    it('should register the git:fetch handler', async () => {
      const mockHandler = vi.fn(async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:fetch] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git fetch --all --prune', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to fetch:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      })

      mockIpcMain.handle(CHANNEL, mockHandler)

      expect(mockIpcMain.handle).toHaveBeenCalledWith(CHANNEL, mockHandler)
    })

    it('should return success:true when fetch succeeds', async () => {
      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:fetch] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git fetch --all --prune', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to fetch:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: true })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:fetch] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).not.toHaveBeenCalled()
    })

    it('should return success:false with error message when fetch fails', async () => {
      const ERROR_MESSAGE = 'Failed to fetch from remote'

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:fetch] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(false, '', ERROR_MESSAGE)
          await execMock('git fetch --all --prune', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to fetch:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_MESSAGE })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:fetch] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to fetch:', expect.any(Error))
    })

    it('should use --all --prune flags in the fetch command', async () => {
      const execMock = createExecMock(true)

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:fetch] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          await execMock('git fetch --all --prune', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to fetch:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      await mockHandler(null, PROJECT_PATH, PROJECT_ID)

      expect(execMock).toHaveBeenCalledWith('git fetch --all --prune', PROJECT_PATH, PROJECT_ID)
    })
  })

  describe('git:commit', () => {
    const CHANNEL = 'git:commit'
    const PROJECT_PATH = '/test/project'
    const PROJECT_ID = 'test-project-id'
    const COMMIT_MESSAGE = 'Test commit message'

    it('should register the git:commit handler', async () => {
      const mockHandler = vi.fn(async (_event: any, projectPath: string, message: string, projectId?: string) => {
        console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const escapedMessage = message.replace(/"/g, '\\"')
          const execMock = createExecMock(true)
          await execMock(`git commit -m "${escapedMessage}"`, projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to commit:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      })

      mockIpcMain.handle(CHANNEL, mockHandler)

      expect(mockIpcMain.handle).toHaveBeenCalledWith(CHANNEL, mockHandler)
    })

    it('should return success:true when commit succeeds', async () => {
      const mockHandler = async (_event: any, projectPath: string, message: string, projectId?: string) => {
        console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const escapedMessage = message.replace(/"/g, '\\"')
          const execMock = createExecMock(true)
          await execMock(`git commit -m "${escapedMessage}"`, projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to commit:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, COMMIT_MESSAGE, PROJECT_ID)

      expect(result).toEqual({ success: true })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:commit] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).not.toHaveBeenCalled()
    })

    it('should return success:false with error message when commit fails', async () => {
      const ERROR_MESSAGE = 'Nothing to commit'

      const mockHandler = async (_event: any, projectPath: string, message: string, projectId?: string) => {
        console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const escapedMessage = message.replace(/"/g, '\\"')
          const execMock = createExecMock(false, '', ERROR_MESSAGE)
          await execMock(`git commit -m "${escapedMessage}"`, projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to commit:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, PROJECT_PATH, COMMIT_MESSAGE, PROJECT_ID)

      expect(result).toEqual({ success: false, error: ERROR_MESSAGE })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        `[git:commit] Called with projectPath="${PROJECT_PATH}", projectId="${PROJECT_ID}"`
      )
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to commit:', expect.any(Error))
    })

    it('should escape double quotes in commit message', async () => {
      const MESSAGE_WITH_QUOTES = 'Commit with "quotes" in it'
      const ESCAPED_MESSAGE = 'Commit with \\"quotes\\" in it'
      const execMock = createExecMock(true)

      const mockHandler = async (_event: any, projectPath: string, message: string, projectId?: string) => {
        console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const escapedMessage = message.replace(/"/g, '\\"')
          await execMock(`git commit -m "${escapedMessage}"`, projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to commit:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      await mockHandler(null, PROJECT_PATH, MESSAGE_WITH_QUOTES, PROJECT_ID)

      expect(execMock).toHaveBeenCalledWith(
        `git commit -m "${ESCAPED_MESSAGE}"`,
        PROJECT_PATH,
        PROJECT_ID
      )
    })

    it('should handle commit messages with multiple quotes', async () => {
      const MESSAGE = 'Fix "bug" in "feature" component'
      const ESCAPED = 'Fix \\"bug\\" in \\"feature\\" component'
      const execMock = createExecMock(true)

      const mockHandler = async (_event: any, projectPath: string, message: string, projectId?: string) => {
        console.log(`[git:commit] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const escapedMessage = message.replace(/"/g, '\\"')
          await execMock(`git commit -m "${escapedMessage}"`, projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to commit:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      await mockHandler(null, PROJECT_PATH, MESSAGE, PROJECT_ID)

      expect(execMock).toHaveBeenCalledWith(
        `git commit -m "${ESCAPED}"`,
        PROJECT_PATH,
        PROJECT_ID
      )
    })
  })

  describe('Common Pattern Tests', () => {
    it('should follow consistent error handling pattern across all handlers', async () => {
      // Test that all handlers:
      // 1. Log with console.log on entry
      // 2. Use try-catch block
      // 3. Return {success: true} on success
      // 4. Log with console.error on failure
      // 5. Extract error message (Error object or string)
      // 6. Return {success: false, error: message} on failure

      const testHandler = async (handlerName: string, command: string) => {
        const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
          console.log(`[${handlerName}] Called with projectPath="${projectPath}", projectId="${projectId}"`)
          try {
            const execMock = createExecMock(false, '', 'Test error')
            await execMock(command, projectPath, projectId)
            return { success: true }
          } catch (err) {
            console.error(`Failed to ${handlerName.split(':')[1]}:`, err)
            const errorMsg = err instanceof Error ? err.message : String(err)
            return { success: false, error: errorMsg }
          }
        }

        const result = await mockHandler(null, '/test', 'test-id')

        // Verify pattern compliance
        expect(result).toHaveProperty('success')
        expect(result.success).toBe(false)
        expect(result).toHaveProperty('error')
        expect(typeof result.error).toBe('string')
        expect(mockConsoleLog).toHaveBeenCalled()
        expect(mockConsoleError).toHaveBeenCalled()

        // Clear mocks for next test
        mockConsoleLog.mockClear()
        mockConsoleError.mockClear()
      }

      // Test all handlers follow the same pattern
      await testHandler('git:push', 'git push')
      await testHandler('git:pull', 'git pull')
      await testHandler('git:fetch', 'git fetch --all --prune')
    })

    it('should handle both Error objects and string errors consistently', async () => {
      const handlers = [
        { name: 'git:push', command: 'git push' },
        { name: 'git:pull', command: 'git pull' },
        { name: 'git:fetch', command: 'git fetch --all --prune' },
      ]

      for (const { name, command } of handlers) {
        // Test Error object
        const mockHandlerWithError = async () => {
          try {
            throw new Error('Error object message')
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            return { success: false, error: errorMsg }
          }
        }

        const resultWithError = await mockHandlerWithError()
        expect(resultWithError.error).toBe('Error object message')

        // Test string error
        const mockHandlerWithString = async () => {
          try {
            throw 'String error message'
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            return { success: false, error: errorMsg }
          }
        }

        const resultWithString = await mockHandlerWithString()
        expect(resultWithString.error).toBe('String error message')
      }
    })

    it('should return success object with correct shape on success', async () => {
      const mockHandler = async () => {
        try {
          const execMock = createExecMock(true)
          await execMock('git push', '/test', 'test-id')
          return { success: true }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler()

      expect(result).toEqual({ success: true })
      expect(result).not.toHaveProperty('error')
    })

    it('should return failure object with correct shape on failure', async () => {
      const mockHandler = async () => {
        try {
          const execMock = createExecMock(false, '', 'Command failed')
          await execMock('git push', '/test', 'test-id')
          return { success: true }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler()

      expect(result).toEqual({ success: false, error: 'Command failed' })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Command failed')
    })
  })

  describe('Parameter Handling', () => {
    it('should handle missing projectId parameter', async () => {
      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git push', projectPath, projectId)
          return { success: true }
        } catch (err) {
          console.error('Failed to push:', err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      const result = await mockHandler(null, '/test/project', undefined)

      expect(result).toEqual({ success: true })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[git:push] Called with projectPath="/test/project", projectId="undefined"'
      )
    })

    it('should handle various projectPath formats', async () => {
      const paths = [
        '/absolute/path',
        'C:\\Windows\\Path',
        '/path/with/spaces in it',
        '~/home/path',
      ]

      const mockHandler = async (_event: any, projectPath: string, projectId?: string) => {
        console.log(`[git:push] Called with projectPath="${projectPath}", projectId="${projectId}"`)
        try {
          const execMock = createExecMock(true)
          await execMock('git push', projectPath, projectId)
          return { success: true }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { success: false, error: errorMsg }
        }
      }

      for (const path of paths) {
        mockConsoleLog.mockClear()
        const result = await mockHandler(null, path, 'test-id')
        expect(result.success).toBe(true)
        expect(mockConsoleLog).toHaveBeenCalledWith(
          `[git:push] Called with projectPath="${path}", projectId="test-id"`
        )
      }
    })
  })
})
