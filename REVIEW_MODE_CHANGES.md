# Review Mode Implementation - Remaining Changes

## Files Already Created ✅
- `src/stores/review-store.ts` - Complete
- `electron/output-monitors/review-detector.ts` - Complete
- `electron/preload.temp.ts` - Ready to copy to `preload.ts`

## Changes Needed

### 1. electron/preload.ts
**Action:** Replace with `electron/preload.temp.ts` (already created)

**What changed:**
- Added ReviewFinding, ReviewResult, ReviewCompletedEvent, ReviewProgressEvent interfaces (after line 137)
- Added `review` section to electronAPI object (after git section, around line 226)

---

### 2. electron/pty-manager.ts

**Change 1 - Line 5:** Add execSync import
```typescript
// OLD:
import { exec } from 'child_process'

// NEW:
import { exec, execSync } from 'child_process'
```

**Change 2 - Line 12-19:** Add hidden field to TerminalInfo
```typescript
export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  title: string
  createdAt: number
  hidden?: boolean // ADD THIS LINE
}
```

**Change 3 - Line 21-26:** Add hidden field to TerminalInstance
```typescript
interface TerminalInstance {
  info: TerminalInfo
  ptyProcess: pty.IPty
  processMonitorInterval?: NodeJS.Timeout
  lastLogTime?: number
  hidden?: boolean // ADD THIS LINE
}
```

**Change 4 - Line 222:** Add hidden option to createTerminal
```typescript
// OLD:
createTerminal(options: { cwd?: string; shell?: string; id?: string } = {}): TerminalInfo {

// NEW:
createTerminal(options: { cwd?: string; shell?: string; id?: string; hidden?: boolean } = {}): TerminalInfo {
```

**Change 5 - Line 259-266:** Update info and instance creation
```typescript
// OLD:
const info: TerminalInfo = {
  id,
  pid: ptyProcess.pid,
  shell,
  cwd: originalCwd,
  title: shell.split('/').pop() || shell,
  createdAt: Date.now(),
}

const instance: TerminalInstance = { info, ptyProcess }

// NEW:
const info: TerminalInfo = {
  id,
  pid: ptyProcess.pid,
  shell,
  cwd: originalCwd,
  title: shell.split('/').pop() || shell,
  createdAt: Date.now(),
  hidden: options.hidden,
}

const instance: TerminalInstance = { info, ptyProcess, hidden: options.hidden }
```

**Change 6 - Line 272-279:** Only send pty:data if not hidden
```typescript
// OLD:
ptyProcess.onData((data) => {
  this.detectorManager.processOutput(id, data)

  if (!this.window.isDestroyed()) {
    this.window.webContents.send('pty:data', id, data)
  }
})

// NEW:
ptyProcess.onData((data) => {
  this.detectorManager.processOutput(id, data)

  if (!options.hidden && !this.window.isDestroyed()) {
    this.window.webContents.send('pty:data', id, data)
  }
})
```

**Change 7 - Line 287-293:** Only send pty:exit if not hidden
```typescript
// OLD:
this.detectorManager.handleTerminalExit(id, exitCode)

if (!this.window.isDestroyed()) {
  this.window.webContents.send('pty:exit', id, exitCode)
}
this.terminals.delete(id)

// NEW:
this.detectorManager.handleTerminalExit(id, exitCode)

if (!options.hidden && !this.window.isDestroyed()) {
  this.window.webContents.send('pty:exit', id, exitCode)
}
this.terminals.delete(id)
```

**Change 8 - After line 344:** Add getDetectorManager method
```typescript
// Add this method at the end of the PtyManager class, before the closing }

/**
 * Get the detector manager (for registering custom detectors like ReviewDetector)
 */
getDetectorManager(): DetectorManager {
  return this.detectorManager
}
```

---

### 3. electron/main.ts

Need to find where PtyManager is created and IPC handlers are registered.

**Step 1:** Import ReviewDetector at the top
```typescript
import { ReviewDetector } from './output-monitors/review-detector'
```

**Step 2:** After PtyManager is created, register ReviewDetector
```typescript
// Find where: const ptyManager = new PtyManager(mainWindow)
// Then add:
const reviewDetector = new ReviewDetector()
ptyManager.getDetectorManager().registerDetector(reviewDetector)
```

**Step 3:** Add review IPC handlers (add these with other ipcMain.handle calls)
```typescript
// Track active reviews
const activeReviews = new Map<string, { terminalId: string; projectPath: string }>()

// Start a code review
ipcMain.handle('review:start', async (_event, projectPath: string, files: string[], prompt: string) => {
  try {
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // Create hidden terminal
    const terminalInfo = ptyManager.createTerminal({
      cwd: projectPath,
      hidden: true,
    })

    // Register this terminal with the review detector
    reviewDetector.registerReview(terminalInfo.id, reviewId)

    // Track active review
    activeReviews.set(reviewId, {
      terminalId: terminalInfo.id,
      projectPath,
    })

    // Build the prompt with file list
    const fileList = files.map(f => `- ${f}`).join('\n')
    const fullPrompt = prompt.replace('{{files}}', fileList)

    // Send the command to terminal
    // Escape quotes in prompt for shell
    const escapedPrompt = fullPrompt.replace(/"/g, '\\"')
    ptyManager.write(terminalInfo.id, `claude "${escapedPrompt}"\n`)

    console.log(`[Review] Started review ${reviewId} in terminal ${terminalInfo.id}`)

    return { success: true, reviewId }
  } catch (error: any) {
    console.error('[Review] Failed to start review:', error)
    return { success: false, error: error.message }
  }
})

// Cancel a review
ipcMain.handle('review:cancel', async (_event, reviewId: string) => {
  const review = activeReviews.get(reviewId)
  if (review) {
    ptyManager.kill(review.terminalId)
    activeReviews.delete(reviewId)
    console.log(`[Review] Cancelled review ${reviewId}`)
  }
})

// Listen for review detector events
ptyManager.getDetectorManager().onEvent((event) => {
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
      ptyManager.kill(review.terminalId)
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
      ptyManager.kill(review.terminalId)
      activeReviews.delete(reviewId)
    }

    console.log(`[Review] Failed review ${reviewId}: ${error}`)
  }
})
```

---

## Next Steps After These Changes

1. Copy `electron/preload.temp.ts` to `electron/preload.ts`
2. Make the changes to `electron/pty-manager.ts` (8 small changes)
3. Add the review handlers to `electron/main.ts` (3 additions)
4. Test that it compiles: `npm run build` or `pnpm build`
5. Then we'll build the UI components (ReviewPanel, GitTab button, etc.)

## Summary of What We're Building

- Hidden terminal support: Terminals can run in background without UI
- ReviewDetector: Parses Claude's JSON output from code reviews
- Review IPC: Start review, get progress, receive findings
- Next: UI to trigger reviews and display results in an overlay panel
