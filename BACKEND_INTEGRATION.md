# Backend Integration Guide

## Overview

This guide shows how to integrate the multi-stage, multi-agent code review system into the backend (`electron/main.ts`).

## Key Components

1. **BackgroundClaudeManager** - Manages multiple concurrent Claude CLI sessions
2. **Multi-Stage Orchestrator** - Coordinates the 3-stage review process
3. **Multi-Agent Coordinator** - Manages 3 reviewers + coordinator + verifiers for high-risk files

## Step 1: Initialize BackgroundClaudeManager

In `electron/main.ts`, add:

```typescript
import { BackgroundClaudeManager } from './background-claude-manager.js'

// After PtyManager is created
const ptyManager = new PtyManager(mainWindow)
const backgroundClaude = new BackgroundClaudeManager(ptyManager)
await backgroundClaude.initialize()

console.log('[Main] BackgroundClaudeManager initialized')
```

## Step 2: Helper Functions

Add these helper functions to build prompts and get file context:

```typescript
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, basename } from 'path'

/**
 * Get git diff for a file
 */
function getFileDiff(file: string, projectPath: string): string {
  try {
    return execSync(`git diff HEAD -- "${file}"`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    })
  } catch (error) {
    return ''
  }
}

/**
 * Get file contents
 */
function getFileContent(file: string, projectPath: string): string {
  try {
    return readFileSync(join(projectPath, file), 'utf-8')
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
 * Build classification prompt
 */
function buildClassificationPrompt(files: string[], projectPath: string): string {
  const fileList = files.map(f => `- ${f}`).join('\n')
  const diffs = files.map(f => {
    const diff = getFileDiff(f, projectPath)
    return `=== ${f} ===\n${diff}\n`
  }).join('\n')

  return `You are analyzing code changes to classify files by risk level.

Classify each file as INCONSEQUENTIAL or HIGH-RISK based on these criteria:

INCONSEQUENTIAL (low risk):
- Configuration files, docs, type definitions, formatting changes
- Comments, simple refactoring, test files

HIGH-RISK (potential bugs/security):
- Business logic, auth, database queries, API handlers
- Security code, payment processing, user data handling

Files to classify:
${fileList}

Diffs:
${diffs}

Output ONLY valid JSON:
[
  {
    "file": "src/config.ts",
    "riskLevel": "inconsequential",
    "reasoning": "Only config values changed"
  }
]`
}

/**
 * Build inconsequential review prompt
 */
function buildInconsequentialPrompt(files: string[], projectPath: string): string {
  const filesWithDiffs = files.map(f => {
    const diff = getFileDiff(f, projectPath)
    return `=== ${f} ===\n${diff}\n`
  }).join('\n')

  return `You are reviewing LOW-RISK code changes for simple issues.

Focus ONLY on:
- Typos, unused imports/variables
- Console.log statements, commented code
- Missing null checks, simple style issues

DO NOT report: Complex logic, architecture, pre-existing issues

Files:
${filesWithDiffs}

Output ONLY valid JSON array with codeChange field:
[
  {
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
]`
}

/**
 * Build sub-agent reviewer prompt
 */
function buildSubAgentPrompt(file: string, projectPath: string, agentNumber: number, riskReasoning: string): string {
  const diff = getFileDiff(file, projectPath)
  const content = getFileContent(file, projectPath)
  const imports = getFileImports(file, projectPath)

  return `You are REVIEWER-${agentNumber} conducting independent review of HIGH-RISK file.

⚠️ ONLY analyze MODIFIED code (in the diff)
⚠️ DO NOT report issues in unchanged code

File: ${file}
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
  const reviewsJson = JSON.stringify(subAgentReviews, null, 2)

  return `You are coordinating findings from 3 independent reviewers.

Tasks:
1. Deduplicate similar findings
2. Consolidate descriptions
3. Calculate confidence (3 agents=1.0, 2=0.85, 1=0.65)
4. Filter out false positives

File: ${file}

Diff:
${diff}

Sub-agent reviews:
${reviewsJson}

Output consolidated findings:
[
  {
    "file": "${file}",
    "line": 42,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection",
    "description": "Found by all 3 agents...",
    "suggestion": "Use parameterized queries",
    "sourceAgents": ["reviewer-1", "reviewer-2", "reviewer-3"],
    "confidence": 1.0
  }
]`
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
```

## Step 3: Multi-Stage Review Orchestrator

Replace the existing `review:start` handler with this multi-stage orchestrator:

```typescript
// Track active reviews
interface ActiveReview {
  reviewId: string
  projectPath: string
  files: string[]
  classifications?: any[]
  inconsequentialFiles?: string[]
  highRiskFiles?: string[]
  currentHighRiskIndex: number
}

const activeReviews = new Map<string, ActiveReview>()

/**
 * Stage 1: Start review with classification
 */
ipcMain.handle('review:start', async (_event, projectPath: string, files: string[]) => {
  const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

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

    if (result.success && result.parsed) {
      const classifications = result.parsed

      // Send to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:classifications', {
          reviewId,
          classifications
        })
      }

      // Update active review
      const review = activeReviews.get(reviewId)
      if (review) {
        review.classifications = classifications
      }

      return { success: true, reviewId }
    } else {
      throw new Error('Classification failed: ' + result.error)
    }
  } catch (error: any) {
    console.error(`[Review] Failed to start review:`, error)
    return { success: false, error: error.message }
  }
})

/**
 * Stage 2: User confirmed classifications, start inconsequential review
 */
ipcMain.handle('review:start-inconsequential', async (_event, reviewId: string, inconsequentialFiles: string[], highRiskFiles: string[]) => {
  const review = activeReviews.get(reviewId)
  if (!review) {
    return { success: false, error: 'Review not found' }
  }

  console.log(`[Review] Starting inconsequential review: ${inconsequentialFiles.length} files`)

  review.inconsequentialFiles = inconsequentialFiles
  review.highRiskFiles = highRiskFiles

  try {
    // Split files into batches for parallel review
    const batchSize = 5
    const batches: string[][] = []
    for (let i = 0; i < inconsequentialFiles.length; i += batchSize) {
      batches.push(inconsequentialFiles.slice(i, i + batchSize))
    }

    // Run batches in parallel
    const batchPromises = batches.map((batch, idx) => {
      const prompt = buildInconsequentialPrompt(batch, review.projectPath)
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

    // Add unique IDs
    const findingsWithIds = allFindings.map((f, idx) => ({
      ...f,
      id: `${reviewId}-inconseq-${idx}`
    }))

    // Send to frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('review:inconsequential-findings', {
        reviewId,
        findings: findingsWithIds
      })
    }

    return { success: true, findingCount: findingsWithIds.length }
  } catch (error: any) {
    console.error(`[Review] Inconsequential review failed:`, error)
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
    return { success: false, error: error.message }
  }
})

/**
 * Cancel review
 */
ipcMain.handle('review:cancel', async (_event, reviewId: string) => {
  activeReviews.delete(reviewId)
  // Cancel any active background tasks for this review
  // (BackgroundClaudeManager will handle cleanup)
  return { success: true }
})
```

## Step 4: Update preload.ts

Add new IPC channels:

```typescript
review: {
  start: (projectPath: string, files: string[]) =>
    ipcRenderer.invoke('review:start', projectPath, files),
  startInconsequentialReview: (reviewId: string, inconsequentialFiles: string[], highRiskFiles: string[]) =>
    ipcRenderer.invoke('review:start-inconsequential', reviewId, inconsequentialFiles, highRiskFiles),
  reviewHighRiskFile: (reviewId: string) =>
    ipcRenderer.invoke('review:review-high-risk-file', reviewId),
  cancel: (reviewId: string) =>
    ipcRenderer.invoke('review:cancel', reviewId),

  // Events
  onClassifications: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => callback(event)
    ipcRenderer.on('review:classifications', handler)
    return () => ipcRenderer.removeListener('review:classifications', handler)
  },
  onInconsequentialFindings: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => callback(event)
    ipcRenderer.on('review:inconsequential-findings', handler)
    return () => ipcRenderer.removeListener('review:inconsequential-findings', handler)
  },
  onHighRiskStatus: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => callback(event)
    ipcRenderer.on('review:high-risk-status', handler)
    return () => ipcRenderer.removeListener('review:high-risk-status', handler)
  },
  onHighRiskFindings: (callback: (event: any) => void) => {
    const handler = (_: any, event: any) => callback(event)
    ipcRenderer.on('review:high-risk-findings', handler)
    return () => ipcRenderer.removeListener('review:high-risk-findings', handler)
  },
}
```

## Step 5: Wire Up Frontend (GitTab.tsx)

Update `GitTab.tsx` to trigger the new flow:

```typescript
// In GitTab.tsx

const handleStartReview = async () => {
  if (!window.electron || changedFiles.length === 0) return

  setIsReviewing(true)

  const filesToReview = changedFiles.map(f => f.path)

  // Start classification
  const result = await window.electron.review.start(projectPath, filesToReview)

  if (result.success) {
    startReview(projectPath, filesToReview, result.reviewId)
    setCurrentReviewId(result.reviewId)
  } else {
    setIsReviewing(false)
    console.error('Failed to start review:', result.error)
  }
}

// Listen for classification results
useEffect(() => {
  if (!window.electron) return

  const unsubClassifications = window.electron.review.onClassifications((event) => {
    setClassifications(event.reviewId, event.classifications)
  })

  const unsubInconseq = window.electron.review.onInconsequentialFindings((event) => {
    setInconsequentialFindings(event.reviewId, event.findings)
  })

  const unsubHighRiskStatus = window.electron.review.onHighRiskStatus((event) => {
    // Update coordinator status in store
    const review = reviews.get(event.reviewId)
    if (review) {
      review.currentFileCoordinatorStatus = event.status
    }
  })

  const unsubHighRiskFindings = window.electron.review.onHighRiskFindings((event) => {
    addHighRiskFindings(event.reviewId, event.findings)
  })

  return () => {
    unsubClassifications()
    unsubInconseq()
    unsubHighRiskStatus()
    unsubHighRiskFindings()
  }
}, [])
```

## Testing

1. Start review with multiple files
2. Verify classification completes within 1 minute
3. Confirm classifications, trigger inconsequential review
4. Verify parallel batches complete
5. Advance to high-risk files
6. Verify 3 agents + coordinator + verifiers run
7. Confirm findings show verification status
8. Test cancellation mid-review

## Troubleshooting

**Review hangs**: Check `backgroundClaude.getStats()` to see active tasks
**Timeout errors**: Increase timeout values (default: 2 minutes)
**JSON parse errors**: Check prompt output in temp files
**Multiple conflicts**: Ensure unique task IDs (BackgroundClaudeManager handles this)
