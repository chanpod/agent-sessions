import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { SSHManager } from '../ssh-manager.js'
import { resolvePathForFs, execInContextAsync } from '../main.js'

interface SearchResult {
  file: string
  line: number
  column: number
  content: string
  matchStart: number
  matchEnd: number
}

/**
 * Register all file system related IPC handlers
 * @param sshManager The SSHManager instance
 */
export function registerFsHandlers(sshManager: SSHManager | null) {
  // File system IPC handlers
  ipcMain.handle('fs:readFile', async (_event, filePath: string, projectId?: string) => {
    try {
      console.log('[fs:readFile] Original path:', filePath, 'projectId:', projectId)

      // Check if this is an SSH project with active tunnel
      if (projectId && sshManager) {
        const status = sshManager.getProjectMasterStatus(projectId)
        if (status.connected) {
          console.log('[fs:readFile] Using SSH tunnel for project:', projectId)
          try {
            // Check if file exists and get size via SSH
            // Use cross-platform stat command (works on both Linux and macOS)
            const statOutput = await sshManager.execViaProjectMaster(
              projectId,
              `if [ -f "${filePath.replace(/"/g, '\\"')}" ]; then stat -f '%z %m' "${filePath.replace(/"/g, '\\"')}" 2>/dev/null || stat -c '%s %Y' "${filePath.replace(/"/g, '\\"')}" 2>/dev/null; fi`
            )

            if (!statOutput || statOutput.trim() === '') {
              return { success: false, error: `File not found: ${filePath}` }
            }

            const [sizeStr, mtimeStr] = statOutput.trim().split(' ')
            const size = parseInt(sizeStr, 10)

            // Limit file size to 5MB for safety
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

      // Local file system path
      const fsPath = resolvePathForFs(filePath)
      console.log('[fs:readFile] Resolved path:', fsPath)
      console.log('[fs:readFile] Path exists:', fs.existsSync(fsPath))

      if (!fs.existsSync(fsPath)) {
        console.error('[fs:readFile] File not found:', fsPath)
        return { success: false, error: `File not found: ${fsPath}` }
      }

      const stats = fs.statSync(fsPath)
      if (stats.isDirectory()) {
        return { success: false, error: 'Path is a directory' }
      }

      // Limit file size to 5MB for safety
      if (stats.size > 5 * 1024 * 1024) {
        return { success: false, error: 'File too large (max 5MB)' }
      }

      const content = fs.readFileSync(fsPath, 'utf-8')
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
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const fsPath = resolvePathForFs(filePath)
      fs.writeFileSync(fsPath, content, 'utf-8')

      // Git status updates are now handled by interval-based polling
      // No need to manually trigger notifications here

      return { success: true }
    } catch (err) {
      console.error('Failed to write file:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:listDir', async (_event, dirPath: string, projectId?: string) => {
    try {
      console.log('[fs:listDir] Original path:', dirPath, 'projectId:', projectId)

      // Check if this is an SSH project with active tunnel
      if (projectId && sshManager) {
        const status = sshManager.getProjectMasterStatus(projectId)
        if (status.connected) {
          console.log('[fs:listDir] Using SSH tunnel for project:', projectId)
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

      // Local file system path
      const fsPath = resolvePathForFs(dirPath)
      console.log('[fs:listDir] Resolved path:', fsPath)

      if (!fs.existsSync(fsPath)) {
        console.error('[fs:listDir] Directory not found:', fsPath)
        return { success: false, error: `Directory not found: ${fsPath}` }
      }

      const stats = fs.statSync(fsPath)
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory' }
      }

      const entries = fs.readdirSync(fsPath, { withFileTypes: true })
      // Keep returning original path format (not UNC) for consistency with user input
      const items = entries.map((entry) => ({
        name: entry.name,
        path: path.posix.join(dirPath, entry.name), // Use posix join to preserve Linux-style paths
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
  })

  // Search files content (using grep or ripgrep)
  ipcMain.handle('fs:searchContent', async (_event, projectPath: string, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean }, projectId?: string) => {
    try {
      console.log('[fs:searchContent] Searching in:', projectPath, 'query:', query, 'options:', options)

      const results: SearchResult[] = []

      // Build grep/ripgrep command
      let grepCmd = ''
      const excludeDirs = 'node_modules|.git|dist|build|.next|out|.turbo|coverage'

      // Check if ripgrep is available (faster and better)
      let useRipgrep = false
      try {
        if (projectId && sshManager) {
          const status = sshManager.getProjectMasterStatus(projectId)
          if (status.connected) {
            await sshManager.execViaProjectMaster(projectId, 'which rg')
            useRipgrep = true
          }
        } else {
          execSync('which rg || where rg', { stdio: 'ignore' })
          useRipgrep = true
        }
      } catch {
        // ripgrep not available, will use grep
      }

      if (useRipgrep) {
        // Use ripgrep (faster, better)
        const flags: string[] = ['--line-number', '--column', '--no-heading', '--with-filename', '--color=never']

        if (!options.caseSensitive) flags.push('--ignore-case')
        if (options.wholeWord) flags.push('--word-regexp')
        if (!options.useRegex) flags.push('--fixed-strings')

        // Escape query for shell
        const escapedQuery = query.replace(/'/g, "'\\''")
        grepCmd = `rg ${flags.join(' ')} '${escapedQuery}' "${projectPath}"`
      } else {
        // Fallback to grep
        const flags: string[] = ['-r', '-n', '--exclude-dir={' + excludeDirs + '}']

        if (!options.caseSensitive) flags.push('-i')
        if (options.wholeWord) flags.push('-w')
        if (!options.useRegex) flags.push('-F')

        // Escape query for shell
        const escapedQuery = query.replace(/'/g, "'\\''")
        grepCmd = `grep ${flags.join(' ')} '${escapedQuery}' "${projectPath}" || true`
      }

      console.log('[fs:searchContent] Command:', grepCmd)

      // Execute search command
      let output = ''
      try {
        output = await execInContextAsync(grepCmd, projectPath, projectId)
      } catch (err: any) {
        // grep exits with code 1 if no matches found, which throws an error
        // Only treat it as a real error if it's not a "no matches" error
        if (err.message && !err.message.includes('exit code 1')) {
          throw err
        }
        output = ''
      }

      if (!output || output.trim() === '') {
        return { success: true, results: [] }
      }

      // Parse output
      const lines = output.split('\n').filter(l => l.trim())

      for (const line of lines) {
        let match: RegExpMatchArray | null

        if (useRipgrep) {
          // ripgrep format: file:line:column:content
          match = line.match(/^(.+?):(\d+):(\d+):(.*)$/)
          if (match) {
            const [, file, lineNum, col, content] = match
            const relativePath = file.startsWith(projectPath)
              ? file.substring(projectPath.length).replace(/^[/\\]/, '')
              : file

            // Find match position in content
            let matchStart = 0
            let matchEnd = query.length

            if (options.useRegex) {
              try {
                const regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
                const regexMatch = content.match(regex)
                if (regexMatch) {
                  matchStart = content.indexOf(regexMatch[0])
                  matchEnd = matchStart + regexMatch[0].length
                }
              } catch {
                // Invalid regex, use simple search
                matchStart = content.toLowerCase().indexOf(query.toLowerCase())
                matchEnd = matchStart + query.length
              }
            } else {
              const searchIn = options.caseSensitive ? content : content.toLowerCase()
              const searchFor = options.caseSensitive ? query : query.toLowerCase()
              matchStart = searchIn.indexOf(searchFor)
              matchEnd = matchStart + query.length
            }

            results.push({
              file: relativePath,
              line: parseInt(lineNum, 10),
              column: parseInt(col, 10),
              content: content.trim(),
              matchStart,
              matchEnd,
            })
          }
        } else {
          // grep format: file:line:content
          match = line.match(/^(.+?):(\d+):(.*)$/)
          if (match) {
            const [, file, lineNum, content] = match
            const relativePath = file.startsWith(projectPath)
              ? file.substring(projectPath.length).replace(/^[/\\]/, '')
              : file

            // Find match position in content
            let matchStart = 0
            let matchEnd = query.length

            if (options.useRegex) {
              try {
                const regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
                const regexMatch = content.match(regex)
                if (regexMatch) {
                  matchStart = content.indexOf(regexMatch[0])
                  matchEnd = matchStart + regexMatch[0].length
                }
              } catch {
                matchStart = content.toLowerCase().indexOf(query.toLowerCase())
                matchEnd = matchStart + query.length
              }
            } else {
              const searchIn = options.caseSensitive ? content : content.toLowerCase()
              const searchFor = options.caseSensitive ? query : query.toLowerCase()
              matchStart = searchIn.indexOf(searchFor)
              matchEnd = matchStart + query.length
            }

            results.push({
              file: relativePath,
              line: parseInt(lineNum, 10),
              column: matchStart + 1, // Convert to 1-based
              content: content.trim(),
              matchStart,
              matchEnd,
            })
          }
        }
      }

      console.log(`[fs:searchContent] Found ${results.length} results`)
      return { success: true, results }
    } catch (err) {
      console.error('Failed to search content:', err)
      return { success: false, error: String(err), results: [] }
    }
  })
}
