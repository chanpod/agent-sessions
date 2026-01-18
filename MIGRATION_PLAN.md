# Migration Plan: Current → Multi-Stage Review

## What Happened

I created a complete new multi-stage review system but accidentally broke compatibility with the existing working system. The new UI expects data structures that don't exist yet in the backend.

## Current State

**Working (Restored)**:
- ✅ `src/components/ReviewPanel.tsx` - Original single-stage UI
- ✅ `src/stores/review-store.ts` - Original store
- ✅ `electron/main.ts` - Original review handler
- ✅ System builds and should work

**New (Not Integrated)**:
- 📁 `src/components/ReviewPanel.new.tsx` - New multi-stage UI
- 📁 `electron/background-claude-manager.ts` - New task manager
- 📄 All documentation files

## Why The Hang Happened

The new `ReviewPanel.tsx` expects:
- `review.stage` - Doesn't exist in current ReviewResult
- `review.classifications` - Doesn't exist
- `review.inconsequentialFiles` - Doesn't exist
- Multi-stage workflow events - Not emitted by backend

So when you ran a review:
1. GitTab called old `review.start()`
2. Backend started review the old way
3. New ReviewPanel tried to read `review.stage` → undefined
4. UI rendered "classifying" stage indefinitely
5. Appeared to hang (actually just wrong UI state)

## Migration Strategy

We have two options:

### Option A: Gradual Migration (Recommended)

**Phase 1: Keep Current System Working**
- Current system remains as-is
- New code stays in separate files
- No breaking changes

**Phase 2: Add BackgroundClaudeManager (No UI Changes)**
- Replace temp file handling in existing `review:start`
- Use BackgroundClaudeManager for single task
- UI stays exactly the same
- Benefit: Fixes timeout/hanging issues

**Phase 3: Add Multi-Stage Backend (No UI Changes)**
- Add classification stage to backend
- Add inconsequential stage to backend
- Add high-risk stage to backend
- But keep using OLD UI (just show all findings together)
- Benefit: Better quality reviews, same UX

**Phase 4: Switch to New UI**
- Enable new ReviewPanel
- Wire up all new event handlers
- User sees multi-stage workflow

### Option B: All-at-Once Migration

Implement everything in one go following `BACKEND_INTEGRATION.md`.

**Pros**: Get all features immediately
**Cons**: Higher risk, more debugging, longer downtime

## Recommended: Phase 2 (Fix Hanging Issue First)

Let's just fix the hanging issue using BackgroundClaudeManager without changing the UI:

### Step 1: Import BackgroundClaudeManager in main.ts

```typescript
import { BackgroundClaudeManager } from './background-claude-manager.js'

// After ptyManager is created
const ptyManager = new PtyManager(mainWindow)
const backgroundClaude = new BackgroundClaudeManager(ptyManager)
await backgroundClaude.initialize()
```

### Step 2: Replace File-Based Review with BackgroundClaudeManager

Replace the existing `review:start` handler (lines 1365-1516) with:

```typescript
ipcMain.handle('review:start', async (_event, projectPath: string, files: string[], prompt: string) => {
  if (!ptyManager || !reviewDetector || !backgroundClaude) {
    return { success: false, error: 'Review system not initialized' }
  }

  try {
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    console.log(`[Review] Starting review ${reviewId} for ${files.length} files`)

    // Build the prompt
    const fileList = files.map(f => `- ${f}`).join('\n')
    const promptWithFiles = prompt.replace('{{files}}', fileList)
    const fullPrompt = `${promptWithFiles}

IMPORTANT: You must output ONLY valid JSON. No explanatory text before or after. No markdown code blocks. Just the raw JSON array. If you use markdown, the parsing will fail.`

    // Run review using BackgroundClaudeManager
    const result = await backgroundClaude.runTask({
      taskId: reviewId,
      prompt: fullPrompt,
      projectPath,
      timeout: 120000 // 2 minutes
    })

    if (result.success) {
      // Extract findings
      const findings = extractFindingsFromOutput(result.output || '')

      // Send completion event
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:completed', {
          reviewId,
          findings,
          summary: findings.length > 0 ? `Found ${findings.length} issue(s)` : 'No issues found',
        })
      }

      console.log(`[Review] Completed review ${reviewId} with ${findings.length} findings`)
      return { success: true, reviewId }
    } else {
      // Send failure event
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('review:failed', reviewId, result.error || 'Review failed')
      }

      return { success: false, error: result.error }
    }
  } catch (error: any) {
    console.error('[Review] Failed to start review:', error)
    return { success: false, error: error.message }
  }
})
```

### Step 3: Keep extractFindingsFromOutput Function

The existing function should still work:

```typescript
function extractFindingsFromOutput(output: string): any[] {
  // ... existing implementation ...
}
```

### Benefits of Phase 2

1. ✅ **Fixes hanging issue** - Proper timeout handling
2. ✅ **No UI changes** - Everything looks the same to users
3. ✅ **No breaking changes** - Existing code paths work
4. ✅ **Enables parallelism** - Can add parallel tasks later
5. ✅ **Low risk** - Minimal code changes

### Testing Phase 2

1. Start a review with 3-5 files
2. Verify it completes within 2 minutes
3. Verify findings appear in UI
4. Verify timeout handling if Claude takes too long
5. Verify multiple concurrent reviews don't conflict

## After Phase 2: Future Phases

Once Phase 2 is stable:

**Phase 3**: Add multi-stage backend (keeps old UI)
- Classification runs first
- Then full review with all findings
- User doesn't see stages, just gets better results

**Phase 4**: Enable new UI
- Switch to ReviewPanel.new.tsx
- Add event handlers in GitTab
- User sees full multi-stage workflow

## Files Organization

```
Current Working Files:
- src/components/ReviewPanel.tsx (old, working)
- src/stores/review-store.ts (old, working)
- electron/main.ts (old review handler)

New Files (Not Yet Integrated):
- src/components/ReviewPanel.new.tsx (new multi-stage UI)
- electron/background-claude-manager.ts (task manager)
- MULTI_STAGE_REVIEW.md (architecture)
- MULTI_AGENT_VERIFICATION.md (verification system)
- REVIEW_PROMPTS.md (all prompts)
- BACKEND_INTEGRATION.md (integration guide)
- IMPLEMENTATION_STATUS.md (status)
- MIGRATION_PLAN.md (this file)
```

## Decision Point

**What should we do?**

1. **Phase 2 Only** - Just fix hanging with BackgroundClaudeManager (~30 min)
2. **Phase 2 + 3** - Fix hanging + add multi-stage backend (~3 hours)
3. **Full Migration** - Everything including new UI (~8 hours)
4. **Nothing** - Keep current system, save new code for later

My recommendation: **Phase 2 Only** for now. Get the hanging fix in, test it thoroughly, then decide if you want the multi-stage features.
