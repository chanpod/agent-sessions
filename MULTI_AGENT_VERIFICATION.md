# Multi-Agent Verification System for High-Risk Reviews

## Problem Statement

Traditional AI code review agents suffer from a critical flaw: they often find issues in files that weren't even modified, creating noise and reducing trust. Additionally, a single agent's findings may not be accurate or comprehensive.

## Solution: Multi-Agent Verification with Consensus

For high-risk files, we implement a multi-agent system with three layers:

1. **3 Independent Reviewer Agents** - Run in parallel with fresh context
2. **1 Coordinator Agent** - Deduplicates and consolidates findings
3. **N Accuracy Checker Agents** - Verify each proposed finding (one per finding)

## Architecture

### High-Risk File Review Flow

```
Start High-Risk File Review
         |
         v
┌─────────────────────────────────┐
│  Stage 1: Parallel Reviews      │
│  - Launch 3 sub-agents          │
│  - Each reviews the file        │
│  - Each has fresh context       │
│  - Run in parallel              │
└─────────────────────────────────┘
         |
         v
┌─────────────────────────────────┐
│  Stage 2: Coordination          │
│  - Coordinator receives all     │
│    findings from 3 agents       │
│  - Deduplicates similar issues  │
│  - Consolidates descriptions    │
│  - Calculates consensus         │
│  - Outputs unified findings     │
└─────────────────────────────────┘
         |
         v
┌─────────────────────────────────┐
│  Stage 3: Accuracy Verification │
│  - For each finding, launch     │
│    accuracy checker agent       │
│  - Checker validates the issue  │
│  - Checks if file was modified  │
│  - Verifies suggestion is valid │
│  - Outputs confidence score     │
└─────────────────────────────────┘
         |
         v
┌─────────────────────────────────┐
│  Stage 4: Present to User       │
│  - Only show verified findings  │
│  - Display confidence scores    │
│  - Show which agents found it   │
│  - User can apply/dismiss       │
└─────────────────────────────────┘
```

## Data Structures

### SubAgentReview
```typescript
interface SubAgentReview {
  agentId: string           // e.g., "reviewer-1", "reviewer-2", "reviewer-3"
  findings: ReviewFinding[] // Raw findings from this agent
  timestamp: number         // When review completed
}
```

### VerificationResult
```typescript
interface VerificationResult {
  findingId: string
  isAccurate: boolean       // Did the checker confirm this issue?
  confidence: number        // 0-1 scale
  reasoning: string         // Why is this accurate/inaccurate
  verifierId: string        // Which checker agent verified this
}
```

### Enhanced ReviewFinding
```typescript
interface ReviewFinding {
  // ... existing fields ...

  // Multi-agent verification
  verificationStatus?: 'pending' | 'verifying' | 'verified' | 'rejected'
  verificationResult?: VerificationResult
  sourceAgents?: string[]   // ["reviewer-1", "reviewer-3"] if 2 agents found it
  confidence?: number       // Aggregated confidence (0-1)
}
```

## Prompts

### 1. Sub-Agent Reviewer Prompt

```
You are one of 3 independent code reviewers analyzing a high-risk file.

CRITICAL INSTRUCTIONS:
- ONLY analyze lines that were MODIFIED in this file
- DO NOT report issues in unchanged code
- Focus on changes made in this specific diff
- Be thorough but accurate

File: {{FILE_PATH}}
This file is high-risk because: {{RISK_REASONING}}

Changes (git diff):
{{FILE_DIFF}}

Full file context:
{{FULL_FILE_CONTENT}}

Dependencies:
{{FILE_IMPORTS}}

Review focus areas:
1. Logic errors in CHANGED lines
2. Security issues introduced by CHANGES
3. Breaking changes to APIs/contracts
4. Data integrity risks from MODIFICATIONS
5. Error handling in MODIFIED code

Output ONLY valid JSON array:
[
  {
    "file": "{{FILE_PATH}}",
    "line": 42,
    "endLine": 45,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection in modified query",
    "description": "The new code concatenates user input directly into SQL query on line 43-44. This change introduces a SQL injection vulnerability.",
    "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = ?', [userId])",
    "codeChange": {
      "oldCode": "const query = `SELECT * FROM users WHERE id = ${userId}`",
      "newCode": "const query = db.query('SELECT * FROM users WHERE id = ?', [userId])"
    }
  }
]

IMPORTANT: Only report issues in lines that appear in the diff. Output [] if no issues found.
```

### 2. Coordinator Agent Prompt

```
You are coordinating the findings from 3 independent code reviewers.

Your job:
1. Deduplicate similar findings (same issue found by multiple agents)
2. Consolidate descriptions into the best explanation
3. Calculate consensus (how many agents found each issue)
4. Filter out false positives
5. Ensure findings only relate to MODIFIED code

Sub-Agent Reviews:
{{SUB_AGENT_REVIEWS_JSON}}

File that was reviewed:
{{FILE_PATH}}

Changes that were made:
{{FILE_DIFF}}

Output consolidated findings as JSON:
[
  {
    "file": "{{FILE_PATH}}",
    "line": 42,
    "endLine": 45,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection vulnerability in user authentication",
    "description": "User input is concatenated directly into SQL query without sanitization. Found by agents: reviewer-1, reviewer-3",
    "suggestion": "Use parameterized queries or ORM to safely handle user input",
    "sourceAgents": ["reviewer-1", "reviewer-3"],
    "confidence": 0.95
  }
]

Confidence calculation:
- Found by 3 agents: 1.0
- Found by 2 agents: 0.85
- Found by 1 agent: 0.65
- Adjust down if descriptions conflict

Only include issues that relate to MODIFIED lines in the diff.
```

### 3. Accuracy Checker Prompt

```
You are verifying the accuracy of a single code review finding.

Your job:
1. Confirm the issue actually exists in the MODIFIED code
2. Verify the issue is in lines that were CHANGED (not pre-existing)
3. Check if the suggested fix is valid
4. Assess the severity accurately

Finding to verify:
{{FINDING_JSON}}

File context:
{{FILE_PATH}}

Changes made (diff):
{{FILE_DIFF}}

Full file:
{{FULL_FILE_CONTENT}}

Output verification result as JSON:
{
  "findingId": "{{FINDING_ID}}",
  "isAccurate": true,
  "confidence": 0.92,
  "reasoning": "Confirmed SQL injection vulnerability on line 43. The code was modified to add user input concatenation. The suggested fix using parameterized queries is correct and follows best practices. Issue is severe and should be addressed."
}

OR if not accurate:
{
  "findingId": "{{FINDING_ID}}",
  "isAccurate": false,
  "confidence": 0.15,
  "reasoning": "The flagged code exists but was NOT modified in this diff. The issue was pre-existing and should not be reported as part of this review. This is a false positive for this change set."
}

Be critical. Reject findings that are in unchanged code.
```

## Backend Implementation

### File: electron/main.ts

Add multi-agent orchestration for high-risk files:

```typescript
// When reviewing a high-risk file
async function reviewHighRiskFile(reviewId: string, file: string, projectPath: string) {
  const review = getReview(reviewId)

  // Update status
  updateReviewStatus(reviewId, { currentFileCoordinatorStatus: 'reviewing' })

  // Stage 1: Launch 3 parallel reviewers
  const subAgentPromises = []
  for (let i = 0; i < 3; i++) {
    const agentId = `reviewer-${i + 1}`
    const prompt = buildSubAgentReviewerPrompt(file, projectPath)
    subAgentPromises.push(runSubAgent(agentId, prompt, projectPath))
  }

  const subAgentReviews = await Promise.all(subAgentPromises)

  // Store sub-agent reviews
  updateReviewStatus(reviewId, {
    currentFileSubAgentReviews: subAgentReviews,
    currentFileCoordinatorStatus: 'coordinating'
  })

  // Stage 2: Coordinator consolidates findings
  const coordinatorPrompt = buildCoordinatorPrompt(subAgentReviews, file, projectPath)
  const consolidatedFindings = await runCoordinator(coordinatorPrompt, projectPath)

  updateReviewStatus(reviewId, {
    currentFileCoordinatorStatus: 'verifying'
  })

  // Stage 3: Accuracy checkers (one per finding)
  const verificationPromises = consolidatedFindings.map(finding => {
    const verifierPrompt = buildAccuracyCheckerPrompt(finding, file, projectPath)
    return runAccuracyChecker(finding.id, verifierPrompt, projectPath)
  })

  const verificationResults = await Promise.all(verificationPromises)

  // Stage 4: Filter and mark verified findings
  const verifiedFindings = consolidatedFindings
    .map((finding, idx) => ({
      ...finding,
      verificationStatus: verificationResults[idx].isAccurate ? 'verified' : 'rejected',
      verificationResult: verificationResults[idx],
      confidence: verificationResults[idx].confidence
    }))
    .filter(f => f.verificationStatus === 'verified')

  // Update review with verified findings
  updateReviewStatus(reviewId, {
    currentFileCoordinatorStatus: 'complete'
  })

  // Send findings to frontend
  sendToFrontend('review:high-risk-findings', {
    reviewId,
    file,
    findings: verifiedFindings
  })
}

async function runSubAgent(agentId: string, prompt: string, cwd: string) {
  return new Promise((resolve) => {
    const terminal = ptyManager.createTerminal({ cwd, hidden: true })
    // Setup detector to capture output
    // Parse JSON findings
    // Resolve with SubAgentReview
  })
}
```

## Preventing Concurrent File Modifications

### Problem
If multiple findings target the same file, applying them concurrently causes conflicts.

### Solution: File-Level Locking

```typescript
interface ReviewResult {
  // ...
  pendingApplications?: Map<string, string[]> // file -> [findingIds being applied]
}

// In applyFinding action
async applyFinding(findingId: string) {
  const finding = getFindingById(findingId)
  if (!finding) return

  // Check if file is locked
  const pendingForFile = state.pendingApplications.get(finding.file) || []
  if (pendingForFile.length > 0) {
    // Wait or queue
    await waitForFileLock(finding.file)
  }

  // Lock file
  addToPendingApplications(finding.file, findingId)

  try {
    // Apply the code change via IPC
    await window.electron.fs.applyCodeChange(finding.file, finding.codeChange)

    // Mark as applied
    markFindingAsApplied(findingId)
  } finally {
    // Unlock file
    removeFromPendingApplications(finding.file, findingId)
  }
}

// For bulk apply
async applySelectedFindings(reviewId: string) {
  const findings = getSelectedFindings(reviewId)

  // Group by file
  const byFile = groupBy(findings, f => f.file)

  // Apply sequentially per file, but files can be done in parallel
  const filePromises = Object.entries(byFile).map(([file, fileFindings]) => {
    // Apply findings for this file sequentially
    return fileFindings.reduce(
      (promise, finding) => promise.then(() => applyFinding(finding.id)),
      Promise.resolve()
    )
  })

  await Promise.all(filePromises)
}
```

## Benefits

1. **Accuracy**: Multiple agents reduce false positives
2. **Consensus**: Findings found by multiple agents are more trustworthy
3. **Verification**: Accuracy checkers catch issues in unchanged code
4. **Fresh Context**: Each sub-agent starts with clean context
5. **Confidence Scores**: Users see how reliable each finding is
6. **No Conflicts**: File locking prevents concurrent modification errors

## UI Enhancements

The UI now shows:
- ✅ **Multi-agent progress bar** with 3 stages
- ✅ **Verification badges** on findings
- ✅ **Confidence scores** (e.g., "92% confidence")
- ✅ **Source agent counts** (e.g., "Found by 2 agents")
- ✅ **Expandable verification details**
- ✅ **Disabled "Next" until verification complete**

## Testing Strategy

1. **Test with unchanged files** - Ensure agents don't report pre-existing issues
2. **Test with obvious bugs** - All 3 agents should find them (confidence: 1.0)
3. **Test with subtle bugs** - Some agents might miss (confidence: 0.65-0.85)
4. **Test false positives** - Accuracy checkers should reject them
5. **Test concurrent applies** - Multiple findings on same file should queue
6. **Test bulk apply across files** - Should apply in parallel per-file, sequential per-finding

## Performance Considerations

- **3 sub-agents in parallel**: ~Same time as 1 agent review
- **Coordinator**: Fast, just deduplication
- **N accuracy checkers in parallel**: Scales with findings, but typically fast
- **Total time**: ~2-3x single agent, but much higher quality

## Fallback Handling

If sub-agents fail:
- Continue with successful agents (minimum 1 required)
- Reduce confidence scores
- Log warnings

If coordinator fails:
- Fall back to simple concatenation
- No deduplication

If accuracy checkers fail:
- Mark finding as "unverified" but still show it
- Reduce confidence to 0.5
- User can still apply

## Future Enhancements

1. **Adaptive agent count**: Use more agents for critical files
2. **Learning from dismissals**: Track which agents produce false positives
3. **Cross-file verification**: Check if changes break other files
4. **Incremental reviews**: Only re-review changed sections on re-review
