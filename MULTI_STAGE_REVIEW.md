# Multi-Stage Code Review System

## Overview

This document describes the new multi-stage code review system that provides a more thorough and intelligent review process for code changes.

## Architecture

### Three-Stage Review Process

1. **Stage 1: Classification** - Analyze all changed files and classify them by risk level
2. **Stage 2: Inconsequential Review** - Bulk review of low-risk files with parallel agents
3. **Stage 3: High-Risk Review** - Detailed, sequential review of high-risk files

## Completed Work

### 1. Data Structures (review-store.ts)

#### New Types
- `FileRiskLevel`: 'inconsequential' | 'high-risk'
- `FileClassification`: Contains file path, risk level, reasoning, and optional user override
- `ReviewStage`: Tracks current stage of the review process
  - 'classifying'
  - 'classification-review'
  - 'reviewing-inconsequential'
  - 'reviewing-high-risk'
  - 'completed'

#### Enhanced ReviewFinding
- Added `codeChange` field for applying fixes
- Added `isSelected` for bulk selection
- Added `isApplied` to track applied fixes
- Added `isDismissed` to track dismissed suggestions

#### Enhanced ReviewResult
- Added `stage` to track current review stage
- Added `classifications` array
- Added `inconsequentialFiles` and `highRiskFiles` arrays
- Added `currentHighRiskFileIndex` for sequential review
- Split findings into `inconsequentialFindings` and `highRiskFindings`
- Added `terminalIds` array for tracking multiple subagent terminals

### 2. Store Actions (review-store.ts)

#### Multi-Stage Actions
- `setReviewStage(reviewId, stage)` - Advance to next stage
- `setClassifications(reviewId, classifications)` - Store file risk classifications
- `updateClassification(reviewId, file, newRiskLevel)` - User adjusts classification
- `confirmClassifications(reviewId)` - User confirms classifications, proceeds to inconsequential review
- `setInconsequentialFindings(reviewId, findings)` - Store bulk review results
- `addHighRiskFindings(reviewId, findings)` - Add findings from high-risk file reviews
- `advanceToNextHighRiskFile(reviewId)` - Move to next high-risk file
- `toggleFindingSelection(findingId)` - Toggle selection for bulk apply
- `selectAllFindings(selected)` - Select/deselect all findings
- `applySelectedFindings(reviewId)` - Apply all selected findings
- `applyFinding(findingId)` - Apply a single finding
- `dismissFinding(findingId)` - Dismiss a finding

### 3. UI Components (ReviewPanel.tsx)

#### New Full-Screen Multi-Stage Dialog
- **Stage Indicator**: Shows progress through review stages
- **Stage 1: Classifying** - Loading screen while AI classifies files
- **Stage 2: Classification Review**
  - Two-column layout: Inconsequential vs High-Risk
  - User can review AI classifications
  - User can move files between categories with "Switch" button
  - Shows reasoning for each classification
  - "Continue to Review" button to proceed
- **Stage 3: Reviewing Inconsequential** - Loading screen while parallel agents work
- **Stage 4: Inconsequential Results**
  - Shows all findings from inconsequential files
  - Checkbox selection for each finding
  - "Select All" / "Deselect All" buttons
  - "Apply Selected (N)" button for bulk application
  - Individual "Apply" and "Dismiss" buttons per finding
  - "Continue to High-Risk Review" button
- **Stage 5: High-Risk Review**
  - Shows one high-risk file at a time
  - Progress indicator (e.g., "2 of 5")
  - Detailed findings with enhanced styling
  - "Next File" / "Complete Review" button
- **Stage 6: Completed**
  - Summary of review
  - Shows total files reviewed, findings, and applied changes

## Remaining Work

### 1. Backend Orchestration

We need to create the backend logic that drives the multi-stage process. This involves:

#### Classification Stage
Create a new IPC handler or enhance existing `review:start` to:
1. Take all changed files
2. Launch a Claude session with a classification prompt
3. Parse the classification results (JSON format)
4. Send classifications to frontend via IPC event

**Classification Prompt Template:**
```
You are reviewing code changes to classify files by risk level.

For each file, determine if changes are:
- INCONSEQUENTIAL: Config files, formatting, comments, docs, simple refactoring, type annotations
- HIGH-RISK: Business logic, security code, authentication, data handling, complex algorithms, API contracts

Output ONLY a JSON array like this:
[
  {
    "file": "src/config.ts",
    "riskLevel": "inconsequential",
    "reasoning": "Only updates configuration values"
  },
  {
    "file": "src/auth/login.ts",
    "riskLevel": "high-risk",
    "reasoning": "Changes authentication logic and session handling"
  }
]

Files to classify:
{{FILE_LIST_WITH_DIFFS}}

Output ONLY the JSON array, no other text.
```

#### Inconsequential Review Stage
After user confirms classifications:
1. Split inconsequential files into batches (e.g., 3-5 files per batch)
2. Launch multiple Claude sessions in parallel (one per batch)
3. Each session uses a lightweight review prompt
4. Aggregate all findings from all sessions
5. Send combined findings to frontend

**Inconsequential Review Prompt Template:**
```
You are reviewing low-risk code changes for minor issues.

Focus on:
- Simple bugs or typos
- Code style inconsistencies
- Simple performance improvements
- Missing null checks
- Unused imports

DO NOT deeply analyze architecture or business logic.

Output findings as JSON array:
[
  {
    "file": "src/utils.ts",
    "line": 42,
    "severity": "suggestion",
    "category": "Style",
    "title": "Unused import",
    "description": "Import 'fs' is declared but never used",
    "suggestion": "Remove the unused import",
    "codeChange": {
      "oldCode": "import fs from 'fs'",
      "newCode": ""
    }
  }
]

Files to review:
{{FILE_LIST_WITH_DIFFS}}

Output ONLY JSON array. If no issues: []
```

#### High-Risk Review Stage
After inconsequential review:
1. Review high-risk files ONE AT A TIME
2. For each file, launch a Claude session with comprehensive prompt
3. Include context about the file's role in the codebase
4. Send findings for current file to frontend
5. Wait for user to click "Next" before proceeding to next file

**High-Risk Review Prompt Template:**
```
You are conducting a detailed code review of a HIGH-RISK file.

File: {{FILE_PATH}}

This file was classified as high-risk because:
{{RISK_REASONING}}

Perform a thorough analysis covering:
1. **Logic Errors**: Incorrect algorithms, off-by-one errors, edge cases
2. **Security**: SQL injection, XSS, authentication bypasses, data exposure
3. **Data Integrity**: Race conditions, data loss, corruption risks
4. **Error Handling**: Unhandled exceptions, missing validation
5. **Performance**: N+1 queries, memory leaks, inefficient algorithms
6. **API Contracts**: Breaking changes to interfaces, incorrect types

Context - Dependencies:
{{FILE_IMPORTS}}

Context - Related Files:
{{RELATED_FILES_SUMMARY}}

Changes:
{{FILE_DIFF}}

Output findings as detailed JSON array:
[
  {
    "file": "{{FILE_PATH}}",
    "line": 156,
    "endLine": 162,
    "severity": "critical",
    "category": "Security",
    "title": "SQL Injection vulnerability",
    "description": "User input is concatenated directly into SQL query without sanitization. An attacker could inject malicious SQL to access or modify data.",
    "suggestion": "Use parameterized queries or an ORM to safely handle user input"
  }
]

Be thorough. Output ONLY JSON array.
```

### 2. Implementation Steps

#### Step 1: Update electron/main.ts

Replace the existing `review:start` handler with a multi-stage orchestrator:

```typescript
// Multi-stage review orchestrator
ipcMain.handle('review:start', async (_event, projectPath: string, files: string[]) => {
  try {
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // Stage 1: Classification
    const classifyTerminal = ptyManager.createTerminal({ cwd: projectPath, hidden: true })
    const classificationPrompt = buildClassificationPrompt(files, projectPath)
    ptyManager.write(classifyTerminal.id, `claude "${escapeProm pt(classificationPrompt)}"\n`)

    // Parse classification results and send to frontend
    // ... (implement classification result parsing)

    return { success: true, reviewId }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// New handler for confirming classifications and starting inconsequential review
ipcMain.handle('review:start-inconsequential', async (_event, reviewId: string, files: string[]) => {
  // Launch parallel agents for inconsequential files
  const batches = chunkArray(files, 5) // 5 files per agent
  const promises = batches.map(batch => reviewBatch(batch, projectPath))
  const results = await Promise.all(promises)
  // Aggregate and send findings
})

// New handler for reviewing next high-risk file
ipcMain.handle('review:review-high-risk-file', async (_event, reviewId: string, file: string) => {
  // Launch single agent with comprehensive prompt
  // Send findings when complete
})
```

#### Step 2: Add IPC Event Handlers to Frontend

In `GitTab.tsx` or appropriate component, listen for new events:

```typescript
useEffect(() => {
  if (!window.electron) return

  // Listen for classification results
  const unsubClassifications = window.electron.review.onClassifications((event) => {
    setClassifications(event.reviewId, event.classifications)
  })

  // Listen for inconsequential findings
  const unsubInconsequential = window.electron.review.onInconsequentialFindings((event) => {
    setInconsequentialFindings(event.reviewId, event.findings)
  })

  // Listen for high-risk findings
  const unsubHighRisk = window.electron.review.onHighRiskFindings((event) => {
    addHighRiskFindings(event.reviewId, event.findings)
  })

  return () => {
    unsubClassifications()
    unsubInconsequential()
    unsubHighRisk()
  }
}, [])
```

#### Step 3: Update electron/preload.ts

Add new IPC channels:

```typescript
review: {
  start: (projectPath: string, files: string[]) =>
    ipcRenderer.invoke('review:start', projectPath, files),
  startInconsequentialReview: (reviewId: string, files: string[]) =>
    ipcRenderer.invoke('review:start-inconsequential', reviewId, files),
  reviewHighRiskFile: (reviewId: string, file: string) =>
    ipcRenderer.invoke('review:review-high-risk-file', reviewId, file),
  onClassifications: (callback: (event: ClassificationEvent) => void) => {
    const handler = (_: any, event: ClassificationEvent) => callback(event)
    ipcRenderer.on('review:classifications', handler)
    return () => ipcRenderer.removeListener('review:classifications', handler)
  },
  onInconsequentialFindings: (callback: (event: FindingsEvent) => void) => {
    const handler = (_: any, event: FindingsEvent) => callback(event)
    ipcRenderer.on('review:inconsequential-findings', handler)
    return () => ipcRenderer.removeListener('review:inconsequential-findings', handler)
  },
  onHighRiskFindings: (callback: (event: FindingsEvent) => void) => {
    const handler = (_: any, event: FindingsEvent) => callback(event)
    ipcRenderer.on('review:high-risk-findings', handler)
    return () => ipcRenderer.removeListener('review:high-risk-findings', handler)
  },
  // ... existing methods
}
```

### 3. Helper Functions Needed

#### Prompt Builders
- `buildClassificationPrompt(files, projectPath)` - Generate classification prompt with file list and diffs
- `buildInconsequentialPrompt(files, projectPath)` - Generate lightweight review prompt
- `buildHighRiskPrompt(file, context, projectPath)` - Generate comprehensive review prompt with context

#### Utilities
- `chunkArray(array, size)` - Split array into chunks for parallel processing
- `getFileDiff(file, projectPath)` - Get git diff for a file
- `getFileImports(file, projectPath)` - Extract import statements for context
- `getRelatedFiles(file, projectPath)` - Find files that import or are imported by this file

## Benefits of Multi-Stage Approach

1. **Efficiency**: Low-risk files reviewed in parallel quickly
2. **Thoroughness**: High-risk files get detailed, focused attention
3. **User Control**: User can adjust classifications and select which fixes to apply
4. **Context-Aware**: High-risk reviews consider file relationships and dependencies
5. **Bulk Operations**: Easy to apply multiple low-risk fixes at once
6. **Progressive Disclosure**: UI only shows relevant information for each stage

## Testing Plan

1. Test classification with various file types
2. Test user reclassification workflow
3. Test parallel inconsequential review with multiple files
4. Test bulk apply/dismiss functionality
5. Test sequential high-risk review
6. Test complete end-to-end workflow
7. Test error handling at each stage
8. Test cancellation during review

## Next Steps

1. Implement backend orchestration in `electron/main.ts`
2. Create prompt builder functions
3. Add new IPC channels to `preload.ts`
4. Wire up frontend event listeners in `GitTab.tsx`
5. Test each stage independently
6. Test complete workflow
7. Add error handling and recovery
8. Add ability to restart failed stages
