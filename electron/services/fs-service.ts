import { ipcMain } from 'electron'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { SSHManager } from '../ssh-manager.js'
import { execInContextAsync } from '../main.js'
import { PathService } from '../utils/path-service.js'

const execAsync = promisify(exec)

/**
 * Project type for search operations
 */
type ProjectType = 'ssh' | 'wsl' | 'windows-local'

/**
 * Determine the project type based on path and SSH connection status
 */
async function getProjectType(projectPath: string, projectId: string | undefined, sshManager: SSHManager | null): Promise<ProjectType> {
  // Check SSH first
  if (projectId && sshManager) {
    const status = await sshManager.getProjectMasterStatus(projectId)
    if (status.connected) {
      return 'ssh'
    }
  }

  // Check WSL
  if (PathService.isWslPath(projectPath)) {
    return 'wsl'
  }

  // Default to Windows local
  return 'windows-local'
}

/** Default directories to exclude from search */
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo', 'coverage', '__pycache__', '.venv', 'venv']

/**
 * Parse user exclusions into directory exclusions and glob patterns
 */
function parseUserExclusions(userExclusions: string[] = []): { dirs: string[]; patterns: string[] } {
  const dirs: string[] = []
  const patterns: string[] = []

  for (const exclusion of userExclusions) {
    // If it contains glob characters, treat as pattern
    if (exclusion.includes('*') || exclusion.includes('?')) {
      patterns.push(exclusion)
    } else {
      // Otherwise treat as directory name
      dirs.push(exclusion)
    }
  }

  return { dirs, patterns }
}

/**
 * Check if a file matches any glob pattern (simple implementation)
 */
function matchesGlobPattern(filename: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars (except * and ?)
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${regexStr}$`, 'i')
  return regex.test(filename)
}

/**
 * Search files using Node.js (for Windows local projects where grep/rg aren't available)
 * This is a fallback when shell-based search tools aren't available
 */
async function searchWithNodeJs(
  projectPath: string,
  query: string,
  options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; userExclusions?: string[] }
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const { dirs: userDirs, patterns: userPatterns } = parseUserExclusions(options.userExclusions)
  const excludeDirs = new Set([...DEFAULT_EXCLUDE_DIRS, ...userDirs])
  const maxFileSize = 1024 * 1024 // 1MB max file size to search
  const maxResults = 1000 // Limit results

  // Build regex for matching
  let pattern: RegExp
  try {
    let regexStr = options.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (options.wholeWord) {
      regexStr = `\\b${regexStr}\\b`
    }
    pattern = new RegExp(regexStr, options.caseSensitive ? 'g' : 'gi')
  } catch (err) {
    console.error('[searchWithNodeJs] Invalid regex pattern:', err)
    return []
  }

  const fsPath = PathService.toFsPath(projectPath)

  // Recursive file walker
  async function walkDir(dir: string, relativePath: string = ''): Promise<void> {
    if (results.length >= maxResults) return

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (results.length >= maxResults) break

        const fullPath = PathService.join(dir, entry.name)
        const relPath = relativePath ? PathService.joinPosix(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
            await walkDir(fullPath, relPath)
          }
        } else if (entry.isFile()) {
          // Skip binary files and large files
          const ext = PathService.extname(entry.name).toLowerCase()
          const binaryExtensions = new Set(['.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.avi', '.mov', '.webm'])
          if (binaryExtensions.has(ext)) continue

          // Check if file matches any user exclusion pattern
          const shouldExclude = userPatterns.some(p => matchesGlobPattern(entry.name, p) || matchesGlobPattern(relPath, p))
          if (shouldExclude) continue

          try {
            const stats = await fs.promises.stat(fullPath)
            if (stats.size > maxFileSize) continue

            const content = await fs.promises.readFile(fullPath, 'utf-8')
            const lines = content.split('\n')

            for (let lineNum = 0; lineNum < lines.length && results.length < maxResults; lineNum++) {
              const line = lines[lineNum]
              pattern.lastIndex = 0 // Reset regex state

              let match: RegExpExecArray | null
              while ((match = pattern.exec(line)) !== null && results.length < maxResults) {
                results.push({
                  file: relPath.replace(/\\/g, '/'), // Normalize to forward slashes
                  line: lineNum + 1,
                  column: match.index + 1,
                  content: line.trim(),
                  matchStart: match.index,
                  matchEnd: match.index + match[0].length
                })

                // Prevent infinite loop for zero-length matches
                if (match[0].length === 0) {
                  pattern.lastIndex++
                }
              }
            }
          } catch (err) {
            // Skip files that can't be read (binary, encoding issues, etc.)
          }
        }
      }
    } catch (err) {
      console.error(`[searchWithNodeJs] Error reading directory ${dir}:`, err)
    }
  }

  await walkDir(fsPath)
  return results
}

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
        const status = await sshManager.getProjectMasterStatus(projectId)
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
      const fsPath = PathService.toFsPath(filePath)
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

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string, projectId?: string) => {
    try {
      console.log('[fs:writeFile] Original path:', filePath, 'projectId:', projectId)

      // Check if this is an SSH project with active tunnel
      if (projectId && sshManager) {
        const status = await sshManager.getProjectMasterStatus(projectId)
        if (status.connected) {
          console.log('[fs:writeFile] Using SSH tunnel for project:', projectId)
          try {
            // Encode content as base64 to safely transfer via SSH
            const base64Content = Buffer.from(content).toString('base64')

            // Write file via SSH using base64 decoding
            // This handles special characters and binary content safely
            await sshManager.execViaProjectMaster(
              projectId,
              `echo "${base64Content}" | base64 -d > "${filePath.replace(/"/g, '\\"')}"`
            )

            console.log('[fs:writeFile] Successfully wrote file via SSH:', filePath)
            return { success: true }
          } catch (err) {
            console.error('[fs:writeFile] SSH command failed:', err)
            return { success: false, error: String(err) }
          }
        }
      }

      // Local file system path
      const fsPath = PathService.toFsPath(filePath)
      console.log('[fs:writeFile] Resolved path:', fsPath)
      fs.writeFileSync(fsPath, content, 'utf-8')

      // Git status updates are now handled by interval-based polling
      // No need to manually trigger notifications here

      return { success: true }
    } catch (err) {
      console.error('[fs:writeFile] Failed to write file:', filePath, 'Error:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:listDir', async (_event, dirPath: string, projectId?: string) => {
    try {
      console.log('[fs:listDir] Original path:', dirPath, 'projectId:', projectId)

      // Check if this is an SSH project with active tunnel
      if (projectId && sshManager) {
        const status = await sshManager.getProjectMasterStatus(projectId)
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
                  path: PathService.joinPosix(dirPath, name),
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
      const fsPath = PathService.toFsPath(dirPath)
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
        path: PathService.joinPosix(dirPath, entry.name), // Use posix join to preserve Linux-style paths
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

  // Search files content (using grep, ripgrep, or Node.js fallback)
  // Handles three project types: SSH, WSL, and Windows local
  ipcMain.handle('fs:searchContent', async (_event, projectPath: string, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; userExclusions?: string[] }, projectId?: string) => {
    try {
      console.log('[fs:searchContent] Searching in:', projectPath, 'query:', query, 'options:', options)

      // Parse user exclusions
      const { dirs: userExcludeDirs, patterns: userExcludePatterns } = parseUserExclusions(options.userExclusions)

      // Determine project type to choose the right search strategy
      const projectType = await getProjectType(projectPath, projectId, sshManager)
      console.log('[fs:searchContent] Project type:', projectType)

      // For Windows local projects, use Node.js-based search (grep/rg not available)
      if (projectType === 'windows-local') {
        console.log('[fs:searchContent] Using Node.js search for Windows local project')
        const results = await searchWithNodeJs(projectPath, query, options)
        console.log(`[fs:searchContent] Found ${results.length} results`)
        return { success: true, results }
      }

      // For SSH and WSL projects, use grep/ripgrep via shell commands
      const results: SearchResult[] = []

      // Detect if this is a WSL path and convert to Linux format for ripgrep/grep
      const pathInfo = PathService.analyzePath(projectPath)
      const isWsl = pathInfo.type === 'wsl-unc' || pathInfo.type === 'wsl-linux'
      const searchPath = isWsl && pathInfo.linuxPath ? pathInfo.linuxPath : projectPath

      console.log('[fs:searchContent] Path info:', pathInfo, 'searchPath:', searchPath)

      // Check if ripgrep is available (faster and better)
      let useRipgrep = false
      try {
        if (projectType === 'ssh' && projectId && sshManager) {
          await sshManager.execViaProjectMaster(projectId, 'which rg')
          useRipgrep = true
        } else if (projectType === 'wsl') {
          // For WSL, check inside WSL environment
          const distroArg = pathInfo.wslDistro ? `-d ${pathInfo.wslDistro} ` : ''
          await execAsync(`wsl ${distroArg}which rg`)
          useRipgrep = true
        }
      } catch {
        // ripgrep not available, will use grep
        console.log('[fs:searchContent] ripgrep not available, falling back to grep')
      }

      // Build the search command
      let grepCmd = ''
      // Combine default exclusions with user directory exclusions
      const excludeDirList = [...DEFAULT_EXCLUDE_DIRS, ...userExcludeDirs]

      if (useRipgrep) {
        // Use ripgrep (faster, better)
        const flags: string[] = ['--line-number', '--column', '--no-heading', '--with-filename', '--color=never']

        if (!options.caseSensitive) flags.push('--ignore-case')
        if (options.wholeWord) flags.push('--word-regexp')
        if (!options.useRegex) flags.push('--fixed-strings')

        // Add exclusion globs for directories that should be skipped
        for (const dir of excludeDirList) {
          flags.push(`--glob '!${dir}/**'`)
        }

        // Add user glob pattern exclusions
        for (const pattern of userExcludePatterns) {
          flags.push(`--glob '!${pattern}'`)
        }

        // Escape query for shell (escapeForBash returns the string wrapped in single quotes)
        const escapedQuery = PathService.escapeForBash(query)
        // Use '.' as the search path since execInContextAsync already cd's to the correct directory.
        // Using double quotes around the path would get corrupted by execInContextAsync's quote escaping for WSL.
        grepCmd = `rg ${flags.join(' ')} ${escapedQuery} .`
      } else {
        // Fallback to grep
        // Build exclude-dir flags separately to avoid brace expansion issues when command
        // is passed through WSL bash -c "..." (braces get interpreted by bash)
        const excludeFlags = excludeDirList.map(dir => `--exclude-dir=${dir}`).join(' ')
        // Add user glob pattern exclusions (grep uses --exclude for file patterns)
        const excludePatternFlags = userExcludePatterns.map(p => `--exclude='${p}'`).join(' ')
        const flags: string[] = ['-r', '-n', excludeFlags]
        if (excludePatternFlags) flags.push(excludePatternFlags)

        if (!options.caseSensitive) flags.push('-i')
        if (options.wholeWord) flags.push('-w')
        if (!options.useRegex) flags.push('-F')

        // Escape query for shell (escapeForBash returns the string wrapped in single quotes)
        const escapedQuery = PathService.escapeForBash(query)
        // Use '.' as the search path since execInContextAsync already cd's to the correct directory.
        // Using double quotes around the path would get corrupted by execInContextAsync's quote escaping for WSL.
        grepCmd = `grep ${flags.join(' ')} ${escapedQuery} . || true`
      }

      console.log('[fs:searchContent] Command:', grepCmd)
      console.log('[fs:searchContent] Calling execInContextAsync with:', {
        command: grepCmd,
        projectPath,
        projectId
      })

      // Execute search command using execInContextAsync which handles SSH/WSL routing
      let output = ''
      try {
        output = await execInContextAsync(grepCmd, projectPath, projectId)
        console.log('[fs:searchContent] execInContextAsync returned, output length:', output?.length || 0)
        if (output) {
          console.log('[fs:searchContent] Output preview:', output.substring(0, 300))
        }
      } catch (err: any) {
        console.log('[fs:searchContent] execInContextAsync threw error:', err.message)
        // grep exits with code 1 if no matches found, which throws an error
        // Only treat it as a real error if it's not a "no matches" error
        if (err.message && !err.message.includes('exit code 1')) {
          throw err
        }
        output = ''
      }

      if (!output || output.trim() === '') {
        console.log('[fs:searchContent] No output from search, returning empty results')
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
            // Clean up the file path - since we search with '.', results will be relative paths
            // Remove leading './' if present to normalize the path
            const relativePath = file.replace(/^\.\//, '')

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
            // Clean up the file path - since we search with '.', results will be relative paths
            // Remove leading './' if present to normalize the path
            const relativePath = file.replace(/^\.\//, '')

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
