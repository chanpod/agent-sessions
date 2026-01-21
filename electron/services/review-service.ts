import { ipcMain, BrowserWindow } from 'electron'
import { execSync, exec } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { generateFileId } from '../file-id-util.js'
import { BackgroundClaudeManager } from '../background-claude-manager.js'
import { PtyManager } from '../pty-manager.js'
import { detectWslPath } from '../utils/wsl-utils.js'

// ============================================================================
// Review Types
// ============================================================================

interface ActiveReview {
  reviewId: string
  projectPath: string
  files: string[]
  classifications?: any[]
  lowRiskFiles?: string[]
  highRiskFiles?: string[]
  currentHighRiskIndex: number
  terminalId?: string
}

const activeReviews = new Map<string, ActiveReview>()

// ============================================================================
// Helper Functions
// ============================================================================

// Execute a command in the appropriate context (local, WSL, or SSH)
function execInContext(command: string, projectPath: string, options: { encoding: 'utf-8' } = { encoding: 'utf-8' }): string {
  const wslInfo = detectWslPath(projectPath)

  if (process.platform === 'win32' && wslInfo.isWslPath) {
    const linuxPath = wslInfo.linuxPath || projectPath
    const distroArg = wslInfo.distro ? `-d ${wslInfo.distro} ` : ''
    // Escape double quotes in the command for WSL
    const escapedCmd = command.replace(/"/g, '\\"')
    return execSync(`wsl ${distroArg}bash -c "cd '${linuxPath}' && ${escapedCmd}"`, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  return execSync(command, {
    cwd: projectPath,
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// Resolve path for file system operations (converts WSL paths to UNC on Windows)
function resolvePathForFs(inputPath: string): string {
  const wslInfo = detectWslPath(inputPath)

  if (process.platform === 'win32' && wslInfo.isWslPath) {
    const uncPath = wslInfo.uncPath
    if (uncPath) {
      return uncPath
    }
  }

  return inputPath
}

/**
 * Get git diff for a file
 */
function getFileDiff(file: string, projectPath: string): string {
  try {
    return execInContext(`git diff HEAD -- "${file}"`, projectPath)
  } catch (error) {
    return ''
  }
}

/**
 * Get file contents
 */
function getFileContent(file: string, projectPath: string): string {
  try {
    const fsPath = resolvePathForFs(projectPath)
    return readFileSync(join(fsPath, file), 'utf-8')
  } catch (error) {
    return ''
  }
}

/**
 * Get imports from a file
 */
function getFileImports(file: string, projectPath: string): string {
  const content = getFileContent(file, projectPath)
  const imports = content.match(/^import .* from .*/gm) || []
  return imports.join('\n')
}

/**
 * Generate hash from file's git diff
 */
function hashFileDiff(file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  return createHash('sha256').update(diff).digest('hex')
}

/**
 * Generate per-file diff hashes for all files
 */
function generatePerFileDiffHashes(files: string[], projectPath: string): Map<string, string> {
  const hashes = new Map<string, string>()

  for (const file of files) {
    const hash = hashFileDiff(file, projectPath)
    hashes.set(file, hash)
    console.log(`[Review] Hash for ${file}: ${hash.slice(0, 8)}...`)
  }

  return hashes
}

/**
 * Build classification prompt (with FileId for exact matching)
 */
function buildClassificationPrompt(files: string[], projectPath: string): string {
  // Build file list with FileIds
  const filesWithIds = files.map(f => {
    const fileId = generateFileId(projectPath, f)
    const diff = getFileDiff(f, projectPath)
    return {
      fileId,
      path: f,
      diff
    }
  })

  const fileList = filesWithIds.map(f => `- ${f.path} (fileId: ${f.fileId})`).join('\n')
  const diffs = filesWithIds.map(f =>
    `=== ${f.path} ===\nFileId: ${f.fileId}\n${f.diff}\n`
  ).join('\n')

  return `You are analyzing code changes to classify files by risk level.

Classify each file as LOW-RISK or HIGH-RISK based on these criteria:

LOW-RISK:
- Configuration files, docs, type definitions, formatting changes
- Comments, simple refactoring, test files

HIGH-RISK (potential bugs/security):
- Business logic, auth, database queries, API handlers
- Security code, payment processing, user data handling

Files to classify:
${fileList}

Diffs:
${diffs}

Output ONLY valid JSON with EXACTLY these fields (including fileId):
[
  {
    "fileId": "project:src/config.ts",
    "file": "src/config.ts",
    "riskLevel": "low-risk",
    "reasoning": "Only config values changed"
  }
]

CRITICAL: You MUST include the exact fileId from the input for each file in your response!`
}

/**
 * Build low-risk review prompt (with FileId for exact matching)
 */
function buildLowRiskPrompt(files: string[], projectPath: string): string {
  // Build file list with FileIds
  const filesWithIds = files.map(f => {
    const fileId = generateFileId(projectPath, f)
    const diff = getFileDiff(f, projectPath)
    return {
      fileId,
      path: f,
      diff
    }
  })

  const filesWithDiffs = filesWithIds.map(f =>
    `=== ${f.path} ===\nFileId: ${f.fileId}\n${f.diff}\n`
  ).join('\n')

  return `You are reviewing LOW-RISK code changes for simple issues.

Focus ONLY on:
- Typos, unused imports/variables
- Console.log statements, commented code
- Missing null checks, simple style issues

DO NOT report: Complex logic, architecture, pre-existing issues

Files:
${filesWithDiffs}

Output ONLY valid JSON array with fileId AND codeChange fields:
[
  {
    "fileId": "project:src/utils.ts",
    "file": "src/utils.ts",
    "line": 42,
    "severity": "suggestion",
    "category": "Code Quality",
    "title": "Unused import",
    "description": "Import 'fs' is never used",
    "suggestion": "Remove unused import",
    "codeChange": {
      "oldCode": "import fs from 'fs'",
      "newCode": ""
    }
  }
]

CRITICAL: You MUST include the exact fileId from the input for each finding!`
}

/**
 * Build sub-agent reviewer prompt (with FileId for exact matching)
 */
function buildSubAgentPrompt(file: string, projectPath: string, agentNumber: number, riskReasoning: string): string {
  const fileId = generateFileId(projectPath, file)
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const imports = getFileImports(file, projectPath)

  return `You are REVIEWER-${agentNumber} conducting independent review of HIGH-RISK file.

⚠️ ONLY analyze MODIFIED code (in the diff)
⚠️ DO NOT report issues in unchanged code

File: ${file}
FileId: ${fileId}
Risk reason: ${riskReasoning}

=== CHANGES (diff) ===
${diff}

=== FULL FILE ===
${content}

=== IMPORTS ===
${imports}

Check for: Logic errors, security flaws, data integrity issues, error handling, breaking changes

Output ONLY valid JSON:
[
  {
    "file": "${file}",
    "line": 42,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection",
    "description": "User input concatenated in query",
    "suggestion": "Use parameterized queries"
  }
]`
}

/**
 * Build coordinator prompt
 */
function buildCoordinatorPrompt(subAgentReviews: any[], file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const reviewsJson = JSON.stringify(subAgentReviews, null, 2)

  return `You are coordinating findings from 3 independent reviewers.

Tasks:
1. Deduplicate similar findings
2. Consolidate descriptions
3. Calculate confidence (3 agents=1.0, 2=0.85, 1=0.65)
4. Filter out false positives
5. Generate EXACT code fixes with old/new code snippets

File: ${file}

Diff:
${diff}

Full file content:
${content}

Sub-agent reviews:
${reviewsJson}

For EACH finding, you MUST provide:
- "aiPrompt": A clear prompt the user can copy to ask AI to fix this issue
- "codeChange": Object with "oldCode" and "newCode" for automatic fixing (if applicable)

Output consolidated findings in this EXACT format:
[
  {
    "file": "${file}",
    "line": 42,
    "endLine": 45,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection vulnerability",
    "description": "User input is directly concatenated into SQL query without sanitization",
    "suggestion": "Use parameterized queries to prevent SQL injection",
    "aiPrompt": "Fix the SQL injection vulnerability on line 42 by converting the string concatenation to use parameterized queries with prepared statements",
    "codeChange": {
      "oldCode": "const query = 'SELECT * FROM users WHERE id = ' + userId",
      "newCode": "const query = 'SELECT * FROM users WHERE id = ?'\\nconst results = await db.execute(query, [userId])"
    },
    "sourceAgents": ["reviewer-1", "reviewer-2", "reviewer-3"],
    "confidence": 1.0
  }
]

IMPORTANT:
- Always include "aiPrompt" for every finding
- Only include "codeChange" if you can provide exact old/new code snippets
- "oldCode" must match EXACTLY what's in the file (including whitespace)
- "newCode" should be the complete fixed version`
}

/**
 * Build accuracy checker prompt
 */
function buildAccuracyPrompt(finding: any, file: string, projectPath: string): string {
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const findingJson = JSON.stringify(finding, null, 2)

  return `You are verifying the accuracy of a code review finding.

Verify:
1. Issue exists in MODIFIED code (not pre-existing)
2. Severity is appropriate
3. Suggested fix is valid

Finding:
${findingJson}

File: ${file}

Diff:
${diff}

Full file:
${content}

Output verification:
{
  "findingId": "${finding.id}",
  "isAccurate": true,
  "confidence": 0.95,
  "reasoning": "Confirmed issue in modified code..."
}`
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function registerReviewHandlers(
  mainWindow: BrowserWindow,
  backgroundClaude: BackgroundClaudeManager,
  ptyManager?: PtyManager
) {
  ipcMain.handle('review:generateFileHashes', async (_event, projectPath: string, files: string[]) => {
    try {
      const hashes = generatePerFileDiffHashes(files, projectPath)
      // Convert Map to object for IPC
      const hashesObj: Record<string, string> = {}
      hashes.forEach((hash, file) => {
        hashesObj[file] = hash
      })
      return { success: true, hashes: hashesObj }
    } catch (error: any) {
      console.error('[Review] Failed to generate file hashes:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('review:start', async (_event, projectPath: string, files: string[], providedReviewId?: string) => {
    const reviewId = providedReviewId || `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    console.log(`[Review] Starting review ${reviewId} for ${files.length} files`)

    try {
      // Store review
      activeReviews.set(reviewId, {
        reviewId,
        projectPath,
        files,
        currentHighRiskIndex: 0
      })

      // Run classification
      const classificationPrompt = buildClassificationPrompt(files, projectPath)

      const result = await backgroundClaude.runTask({
        taskId: `${reviewId}-classify`,
        prompt: classificationPrompt,
        projectPath,
        timeout: 60000 // 1 minute
      })

      console.log(`[Review] Classification result:`, {
        success: result.success,
        hasParsed: !!result.parsed,
        outputLength: result.output?.length,
        error: result.error
      })

      if (result.success && result.parsed) {
        const classifications = result.parsed

        console.log(`[Review] Sending ${classifications.length} classifications to frontend`)

        // Ensure all classifications have fileId
        const classificationsWithFileId = classifications.map((c: any) => ({
          ...c,
          fileId: c.fileId || generateFileId(projectPath, c.file) // Fallback if AI didn't include it
        }))

        // Send to frontend
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('review:classifications', {
            reviewId,
            classifications: classificationsWithFileId
          })
        }

        // Update active review
        const review = activeReviews.get(reviewId)
        if (review) {
          review.classifications = classificationsWithFileId
        }

        return { success: true, reviewId }
      } else {
        // Log the raw output to help debug
        console.error(`[Review] Classification failed to parse. Raw output:`, result.output?.substring(0, 500))
        throw new Error('Classification failed: Could not parse JSON from Claude output')
      }
    } catch (error: any) {
      console.error(`[Review] Failed to start review:`, error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Stage 2: User confirmed classifications, start low-risk review
   */
  ipcMain.handle('review:start-low-risk', async (_event, reviewId: string, lowRiskFiles: string[], highRiskFiles: string[]) => {
    const review = activeReviews.get(reviewId)
    if (!review) {
      return { success: false, error: 'Review not found' }
    }

    console.log(`[Review] Starting low-risk review: ${lowRiskFiles.length} files`)

    review.lowRiskFiles = lowRiskFiles
    review.highRiskFiles = highRiskFiles

    // Handle case where all files were cached (0 files to review)
    if (lowRiskFiles.length === 0) {
      console.log('[Review] No files to review (all cached), sending empty findings')
      if (mainWindow) {
        mainWindow.webContents.send('review:low-risk-findings', {
          reviewId,
          findings: []
        })
      }
      return { success: true }
    }

    try {
      // Split files into batches for parallel review
      const batchSize = 5
      const batches: string[][] = []
      for (let i = 0; i < lowRiskFiles.length; i += batchSize) {
        batches.push(lowRiskFiles.slice(i, i + batchSize))
      }

      // Run batches in parallel
      const batchPromises = batches.map((batch, idx) => {
        const prompt = buildLowRiskPrompt(batch, review.projectPath)
        return backgroundClaude.runTask({
          taskId: `${reviewId}-batch-${idx}`,
          prompt,
          projectPath: review.projectPath,
          timeout: 90000 // 1.5 minutes per batch
        })
      })

      const results = await Promise.all(batchPromises)

      // Aggregate findings
      const allFindings: any[] = []
      for (const result of results) {
        if (result.success && result.parsed) {
          allFindings.push(...result.parsed)
        }
      }

      // Add unique IDs and ensure fileId is present
      const findingsWithIds = allFindings.map((f, idx) => ({
        ...f,
        id: `${reviewId}-low-risk-${idx}`,
        fileId: f.fileId || generateFileId(review.projectPath, f.file) // Fallback if AI didn't include it
      }))

      // Send to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:low-risk-findings', {
          reviewId,
          findings: findingsWithIds
        })
      }

      return { success: true, findingCount: findingsWithIds.length }
    } catch (error: any) {
      console.error(`[Review] Low-risk review failed:`, error)

      // Send failure event to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:failed', reviewId, error.message || 'Low-risk review failed')
      }

      return { success: false, error: error.message }
    }
  })

  /**
   * Stage 3: Review next high-risk file with multi-agent verification
   */
  ipcMain.handle('review:review-high-risk-file', async (_event, reviewId: string) => {
    const review = activeReviews.get(reviewId)
    if (!review || !review.highRiskFiles || !review.classifications) {
      return { success: false, error: 'Review not found or not ready' }
    }

    const fileIndex = review.currentHighRiskIndex
    if (fileIndex >= review.highRiskFiles.length) {
      return { success: true, complete: true }
    }

    const file = review.highRiskFiles[fileIndex]
    console.log(`[Review] Reviewing high-risk file ${fileIndex + 1}/${review.highRiskFiles.length}: ${file}`)

    try {
      // Get classification reasoning
      const classification = review.classifications.find((c: any) => c.file === file)
      const riskReasoning = classification?.reasoning || 'High-risk file'

      // Update status
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:high-risk-status', {
          reviewId,
          file,
          status: 'reviewing'
        })
      }

      // Step 1: Run 3 sub-agents in parallel
      const subAgentPromises = [1, 2, 3].map(agentNum => {
        const prompt = buildSubAgentPrompt(file, review.projectPath, agentNum, riskReasoning)
        return backgroundClaude.runTask({
          taskId: `${reviewId}-file${fileIndex}-agent${agentNum}`,
          prompt,
          projectPath: review.projectPath,
          timeout: 120000 // 2 minutes per agent
        })
      })

      const subAgentResults = await Promise.all(subAgentPromises)

      // Extract findings from each agent
      const subAgentReviews = subAgentResults.map((result, idx) => ({
        agentId: `reviewer-${idx + 1}`,
        findings: result.success && result.parsed ? result.parsed : [],
        timestamp: Date.now()
      }))

      // Update status
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:high-risk-status', {
          reviewId,
          file,
          status: 'coordinating'
        })
      }

      // Step 2: Coordinator consolidates findings
      const coordinatorPrompt = buildCoordinatorPrompt(subAgentReviews, file, review.projectPath)
      const coordinatorResult = await backgroundClaude.runTask({
        taskId: `${reviewId}-file${fileIndex}-coordinator`,
        prompt: coordinatorPrompt,
        projectPath: review.projectPath,
        timeout: 60000
      })

      if (!coordinatorResult.success || !coordinatorResult.parsed) {
        throw new Error('Coordinator failed')
      }

      const consolidatedFindings = coordinatorResult.parsed

      // Update status
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:high-risk-status', {
          reviewId,
          file,
          status: 'verifying'
        })
      }

      // Step 3: Accuracy checkers verify each finding
      const verificationPromises = consolidatedFindings.map((finding: any, idx: number) => {
        finding.id = `${reviewId}-highrisk-${fileIndex}-${idx}`
        const prompt = buildAccuracyPrompt(finding, file, review.projectPath)
        return backgroundClaude.runTask({
          taskId: `${reviewId}-file${fileIndex}-verify-${idx}`,
          prompt,
          projectPath: review.projectPath,
          timeout: 60000
        })
      })

      const verificationResults = await Promise.all(verificationPromises)

      // Filter to verified findings
      const verifiedFindings = consolidatedFindings
        .map((finding: any, idx: number) => {
          const verification = verificationResults[idx]
          const verificationData = verification.success && verification.parsed ? verification.parsed : null

          return {
            ...finding,
            verificationStatus: verificationData?.isAccurate ? 'verified' : 'rejected',
            verificationResult: verificationData,
            confidence: verificationData?.confidence || 0
          }
        })
        .filter((f: any) => f.verificationStatus === 'verified')

      // Update status
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:high-risk-status', {
          reviewId,
          file,
          status: 'complete'
        })

        // Send findings
        mainWindow.webContents.send('review:high-risk-findings', {
          reviewId,
          file,
          findings: verifiedFindings
        })
      }

      // Advance to next file
      review.currentHighRiskIndex++

      return {
        success: true,
        complete: review.currentHighRiskIndex >= review.highRiskFiles.length,
        findingCount: verifiedFindings.length
      }
    } catch (error: any) {
      console.error(`[Review] High-risk file review failed:`, error)

      // Send failure event to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:failed', reviewId, error.message || 'High-risk file review failed')
      }

      return { success: false, error: error.message }
    }
  })

  /**
   * Cancel review
   */
  ipcMain.handle('review:cancel', async (_event, reviewId: string) => {
    console.log(`[Review] Cancelling review ${reviewId}`)

    const review = activeReviews.get(reviewId)

    // Cancel all active background tasks for this review
    if (backgroundClaude) {
      const stats = backgroundClaude.getStats()
      console.log(`[Review] Active tasks before cancel:`, stats.activeTasks)

      // Cancel all tasks related to this review
      for (const task of stats.tasks) {
        if (task.taskId.startsWith(reviewId)) {
          console.log(`[Review] Cancelling task: ${task.taskId}`)
          backgroundClaude.cancelTask(task.taskId)
        }
      }
    }

    // Kill any terminals associated with this review
    if (review?.terminalId && ptyManager) {
      console.log(`[Review] Killing terminal: ${review.terminalId}`)
      try {
        ptyManager.kill(review.terminalId)
      } catch (error) {
        console.error(`[Review] Failed to kill terminal:`, error)
      }
    }

    // Remove from active reviews
    activeReviews.delete(reviewId)
    console.log(`[Review] Review ${reviewId} cancelled and cleaned up`)

    return { success: true }
  })
}

// ============================================================================
// Event Handler Registration
// ============================================================================

export function registerReviewDetectorEvents(
  mainWindow: BrowserWindow,
  detectorManager: any,
  ptyManager?: PtyManager
) {
  // Listen for review detector events
  detectorManager.onEvent((event: any) => {
    if (event.type === 'review-completed') {
      const { reviewId, findings } = event.data

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:completed', {
          reviewId,
          findings: findings.map((f: any, index: number) => ({
            ...f,
            id: `${reviewId}-finding-${index}`,
          })),
        })
      }

      // Cleanup
      const review = activeReviews.get(reviewId)
      if (review) {
        ptyManager?.kill(review.terminalId)
        activeReviews.delete(reviewId)
      }

      console.log(`[Review] Completed review ${reviewId} with ${findings.length} findings`)
    } else if (event.type === 'review-failed') {
      const { reviewId, error } = event.data

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:failed', reviewId, error)
      }

      // Cleanup
      const review = activeReviews.get(reviewId)
      if (review) {
        ptyManager?.kill(review.terminalId)
        activeReviews.delete(reviewId)
      }

      console.log(`[Review] Failed review ${reviewId}: ${error}`)
    }
  })
}
