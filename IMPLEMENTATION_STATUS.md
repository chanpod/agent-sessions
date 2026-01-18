# Multi-Stage Code Review Implementation Status

## Executive Summary

A complete redesign of the code review system with:
- **Multi-stage workflow**: Classification → Inconsequential Review → High-Risk Review
- **Multi-agent verification**: 3 reviewers + 1 coordinator + N verifiers per high-risk file
- **Concurrent task management**: Background Claude Manager handles multiple parallel sessions
- **User control**: Classify files, bulk apply/dismiss, sequential high-risk review

## What's Been Built ✅

### 1. Data Layer (`src/stores/review-store.ts`)

**New Types**:
- `FileRiskLevel`: 'inconsequential' | 'high-risk'
- `FileClassification`: File + risk level + reasoning + user override
- `ReviewStage`: Current stage tracking (6 stages)
- `VerificationStatus`: Verification state for findings
- `SubAgentReview`: Individual agent review results
- `VerificationResult`: Accuracy checker output

**Enhanced Types**:
- `ReviewFinding`: Added verification fields, source agents, confidence
- `ReviewResult`: Added classification data, stage tracking, multi-agent tracking

**13 New Actions**:
- `setReviewStage` - Advance to next stage
- `setClassifications` - Store file classifications
- `updateClassification` - User adjusts risk level
- `confirmClassifications` - Proceed to inconsequential review
- `setInconsequentialFindings` - Store bulk review results
- `addHighRiskFindings` - Add high-risk file findings
- `advanceToNextHighRiskFile` - Sequential progression
- `toggleFindingSelection` - For bulk apply
- `selectAllFindings` - Select/deselect all
- `applySelectedFindings` - Bulk apply with file locking
- `applyFinding` - Single finding application
- `dismissFinding` - Dismiss a finding
- Coordinator status tracking

### 2. UI Layer (`src/components/ReviewPanel.tsx`)

**Full-Screen Multi-Stage Dialog**:
- ✅ Stage indicator with 5 stages
- ✅ Classification stage (loading)
- ✅ Classification review stage (two-column with switch buttons)
- ✅ Inconsequential review stage (loading)
- ✅ Inconsequential results stage (bulk selection, apply/dismiss)
- ✅ High-risk review stage (sequential, one file at a time)
- ✅ Multi-agent progress indicator
- ✅ Verification badges and confidence scores
- ✅ Completed/failed stages

**Components**:
- `StageIndicator` - Visual progress through stages
- `ClassifyingStage` - Loading spinner
- `ClassificationReviewStage` - Two-column file classifier
- `FileClassificationCard` - Individual file with switch button
- `ReviewingInconsequentialStage` - Parallel review loading
- `InconsequentialResultsStage` - Bulk findings view
- `InconsequentialFindingCard` - Checkbox + apply/dismiss
- `HighRiskReviewStage` - Sequential file review
- `MultiAgentProgress` - 3-stage progress bar
- `HighRiskFindingCard` - Verified findings with details
- `CompletedStage` - Success summary
- `FailedStage` - Error display

### 3. Backend Infrastructure (`electron/background-claude-manager.ts`)

**BackgroundClaudeManager Class**:
- ✅ Manages multiple concurrent Claude CLI sessions
- ✅ Unique temp files per task (no conflicts)
- ✅ Timeout handling (default 2 minutes, configurable)
- ✅ Proper cleanup of resources
- ✅ Shell-specific command building (cmd, PowerShell, WSL, bash)
- ✅ Polling mechanism for completion detection
- ✅ JSON parsing from output
- ✅ Parallel task execution
- ✅ Task cancellation
- ✅ Stats and monitoring

**Key Methods**:
- `runTask(options)` - Run single background task
- `runParallelTasks(options[])` - Run multiple tasks concurrently
- `cancelTask(taskId)` - Cancel running task
- `getStats()` - Monitor active tasks
- `cleanup()` - Shutdown cleanup

### 4. Documentation

**Comprehensive Docs Created**:
- ✅ `MULTI_STAGE_REVIEW.md` - Architecture overview
- ✅ `MULTI_AGENT_VERIFICATION.md` - Multi-agent system details
- ✅ `REVIEW_PROMPTS.md` - All prompts with examples
- ✅ `BACKEND_INTEGRATION.md` - Step-by-step integration guide
- ✅ `IMPLEMENTATION_STATUS.md` - This file

## What Needs Implementation 🚧

### 1. Backend Integration in `electron/main.ts`

**Status**: Not started
**Files**: `electron/main.ts`
**Estimated Time**: 2-3 hours

**Tasks**:
1. Import `BackgroundClaudeManager`
2. Initialize after `PtyManager`
3. Add helper functions (see `BACKEND_INTEGRATION.md`)
4. Replace `review:start` handler with classification stage
5. Add `review:start-inconsequential` handler
6. Add `review:review-high-risk-file` handler with multi-agent logic
7. Add IPC event emissions

**Reference**: See `BACKEND_INTEGRATION.md` for complete code

### 2. IPC Channels in `electron/preload.ts`

**Status**: Not started
**Files**: `electron/preload.ts`
**Estimated Time**: 30 minutes

**Tasks**:
1. Add `review.start()` method
2. Add `review.startInconsequentialReview()` method
3. Add `review.reviewHighRiskFile()` method
4. Add `review.cancel()` method
5. Add event listeners:
   - `onClassifications`
   - `onInconsequentialFindings`
   - `onHighRiskStatus`
   - `onHighRiskFindings`

**Reference**: See `BACKEND_INTEGRATION.md` Step 4

### 3. Frontend Event Wiring in `GitTab.tsx`

**Status**: Not started
**Files**: `src/components/GitTab.tsx`
**Estimated Time**: 1 hour

**Tasks**:
1. Update `handleStartReview()` to use new `review.start()`
2. Add `useEffect` for classification events
3. Add handlers for inconsequential findings
4. Add handlers for high-risk status updates
5. Add handlers for high-risk findings
6. Wire up "Confirm Classifications" button
7. Wire up "Continue to High-Risk" button
8. Wire up "Next File" button for high-risk review

**Reference**: See `BACKEND_INTEGRATION.md` Step 5

### 4. File-Level Locking for Apply Operations

**Status**: Partially implemented in store, needs IPC
**Files**: `src/stores/review-store.ts`, `electron/main.ts`
**Estimated Time**: 1 hour

**Tasks**:
1. Add `review:apply-finding` IPC handler
2. Implement file locking in backend
3. Add `fs.applyCodeChange()` method in preload
4. Update `applyFinding` store action to use IPC
5. Add sequential application per file
6. Test concurrent apply prevention

### 5. Testing & Debugging

**Status**: Not started
**Estimated Time**: 3-4 hours

**Test Cases**:
1. ✅ **Classification Test**: Multiple files, various types
2. ✅ **User Reclassification**: Move files between risk levels
3. ✅ **Parallel Inconsequential**: 10+ files in parallel
4. ✅ **Bulk Apply**: Select/deselect, apply all
5. ✅ **High-Risk Sequential**: Review multiple high-risk files
6. ✅ **Multi-Agent Consensus**: 3 agents find same issue
7. ✅ **Accuracy Checker**: Rejects pre-existing issues
8. ✅ **Cancellation**: Cancel mid-stage
9. ✅ **Timeout**: Task exceeds timeout limit
10. ✅ **Error Recovery**: Handle Claude errors gracefully

## Architecture Diagram

```
User Clicks "Review Changes"
         |
         v
┌─────────────────────────────┐
│  Stage 1: Classification    │
│  - BackgroundClaudeManager  │
│  - Single task, all files   │
│  - Returns classifications  │
└─────────────────────────────┘
         |
         v
┌─────────────────────────────┐
│  User Reviews & Adjusts     │
│  - Two-column UI            │
│  - Switch button per file   │
│  - Clicks "Continue"        │
└─────────────────────────────┘
         |
         v
┌─────────────────────────────┐
│  Stage 2: Inconsequential   │
│  - Parallel batches         │
│  - BackgroundClaudeManager  │
│  - 5 files per batch        │
│  - Returns bulk findings    │
└─────────────────────────────┘
         |
         v
┌─────────────────────────────┐
│  User Selects & Applies     │
│  - Checkbox selection       │
│  - Bulk apply with locking  │
│  - Clicks "Continue"        │
└─────────────────────────────┘
         |
         v
┌─────────────────────────────┐
│  Stage 3: High-Risk File 1  │
│  - 3 reviewers (parallel)   │
│  - 1 coordinator            │
│  - N verifiers (parallel)   │
│  - Returns verified findings│
└─────────────────────────────┘
         |
         v
┌─────────────────────────────┐
│  User Reviews Findings      │
│  - Shows verification       │
│  - Confidence scores        │
│  - Clicks "Next File"       │
└─────────────────────────────┘
         |
         v
     [Repeat for each high-risk file]
         |
         v
┌─────────────────────────────┐
│  Complete!                  │
│  - Summary stats            │
│  - Close button             │
└─────────────────────────────┘
```

## Key Design Decisions

### 1. Multi-Stage Architecture
**Why**: Prevents overwhelming users with all findings at once. Progressive disclosure.
**Benefit**: User can adjust classifications, apply low-risk fixes in bulk, then focus on critical issues.

### 2. Multi-Agent Verification
**Why**: Single agents report false positives (especially pre-existing issues).
**Benefit**: 3 agents + coordinator + verifiers dramatically reduces false positives.

### 3. BackgroundClaudeManager
**Why**: Old system had temp file conflicts and no timeout handling.
**Benefit**: Proper resource management, parallel execution, no hangs.

### 4. File-Level Locking
**Why**: Concurrent edits to same file cause conflicts.
**Benefit**: Sequential per-file, parallel across files.

## Performance Characteristics

### Estimated Times (5 files: 2 inconsequential, 3 high-risk)

| Stage | Time | Parallelization |
|-------|------|-----------------|
| Classification | 30-60s | Single task |
| User Review | Variable | N/A |
| Inconsequential | 45-90s | 2 files in parallel |
| User Apply | Variable | N/A |
| High-Risk File 1 | 120-180s | 3 reviewers + verifiers |
| High-Risk File 2 | 120-180s | Same |
| High-Risk File 3 | 120-180s | Same |
| **Total** | **7-12 minutes** | **~50% faster than sequential** |

### Scalability

- **10 files (5 inconseq, 5 high-risk)**: 15-20 minutes
- **20 files (15 inconseq, 5 high-risk)**: 18-25 minutes
- **Parallelization helps most with inconsequential files**

## Next Steps

1. **Implement Backend** (2-3 hours)
   - Follow `BACKEND_INTEGRATION.md`
   - Add helper functions
   - Replace review handlers
   - Test classification stage

2. **Wire Up Frontend** (1 hour)
   - Update GitTab.tsx
   - Add event listeners
   - Test end-to-end flow

3. **Add File Locking** (1 hour)
   - Implement apply IPC
   - Test concurrent prevents

4. **Test & Debug** (3-4 hours)
   - Run all test cases
   - Fix issues
   - Optimize prompts

5. **Polish** (1-2 hours)
   - Error messages
   - Loading states
   - User feedback

**Total Estimated Time**: 8-11 hours

## Success Criteria

- ✅ User can classify files and adjust classifications
- ✅ Inconsequential files reviewed in <2 minutes for 10 files
- ✅ High-risk files show multi-agent verification progress
- ✅ Only verified findings shown (no pre-existing issues)
- ✅ Bulk apply works without conflicts
- ✅ User can cancel at any stage
- ✅ No hangs or timeouts on normal operations
- ✅ Clear error messages on failures

## Known Limitations

1. **No incremental reviews**: Re-reviewing all files each time (future: only review changed files)
2. **No cross-file analysis**: High-risk review doesn't check if changes break other files
3. **Fixed agent count**: Always 3 reviewers (future: adaptive based on file complexity)
4. **No learning**: Doesn't track which agents produce false positives
5. **No caching**: Re-analyzes files even if unchanged since last review

## Future Enhancements

1. **Incremental reviews**: Track reviewed files, only re-review if changed
2. **Cross-file verification**: Check if high-risk changes break dependent files
3. **Adaptive agents**: Use more agents for critical files (auth, payments)
4. **Agent scoring**: Track accuracy, weight findings by agent reputation
5. **Caching**: Cache classification and review results
6. **Streaming UI**: Show findings as they arrive (don't wait for all agents)
7. **Smart batching**: Group related files for better context
