# Expert Reviewers

Expert reviewers are specialized code review agents that provide deep analysis in specific domains. They are **manually triggered** to give you explicit control over AI usage.

## Overview

The review system has two types of files:
- **Inconsequential**: Low-risk changes reviewed quickly
- **High-risk**: Critical changes reviewed thoroughly by multiple agents

For both types, you can optionally flag files for **expert review** with domain specialists.

## Available Expert Reviewers

### 1. Security Expert
**Focus**: Authentication, authorization, crypto, input validation, vulnerabilities
**Priority**: Major (thorough review)
**Best for**: Login systems, API endpoints, payment processing, data encryption

**Checks for**:
- SQL/NoSQL/Command injection
- XSS vulnerabilities
- Authentication/authorization flaws
- Sensitive data exposure
- Insecure cryptography
- Access control issues

### 2. UI/UX Expert
**Focus**: Component design, usability, user experience
**Priority**: Minor (quick check)
**Best for**: React components, forms, navigation, interactive elements

**Checks for**:
- Missing loading/error states
- Poor user feedback
- Accessibility issues (basic)
- Inconsistent design
- Form usability problems
- Responsive design issues

### 3. Performance Expert
**Focus**: Database queries, algorithms, memory usage, scalability
**Priority**: Major (thorough review)
**Best for**: Database access, loops, API calls, data processing

**Checks for**:
- N+1 query problems
- Inefficient algorithms (O(n²))
- Memory leaks
- Sequential operations that could be parallel
- Missing React memoization
- Resource management issues

### 4. Accessibility Expert
**Focus**: WCAG 2.1 AA compliance, screen readers, keyboard navigation
**Priority**: Minor (quick check)
**Best for**: UI components, forms, interactive widgets, modal dialogs

**Checks for**:
- Non-semantic HTML
- Missing ARIA attributes
- Keyboard navigation issues
- Form accessibility
- Color contrast problems
- Screen reader support

### 5. Database Expert
**Focus**: Schema design, migrations, data integrity, query optimization
**Priority**: Major (thorough review)
**Best for**: Database migrations, schema changes, complex queries

**Checks for**:
- Data integrity issues
- Missing constraints/indexes
- Unsafe migrations (data loss)
- Query performance
- Transaction safety
- Concurrency issues

## How to Use

### During Classification Review

After files are classified as "inconsequential" or "high-risk", you can manually flag specific files for expert review:

```typescript
// In your UI during the classification review stage
reviewStore.addExpertFlag(
  reviewId,
  'src/auth/login.ts',
  'security',  // Expert type
  'major'      // Priority: 'minor' or 'major'
)
```

### Flag Priority

- **Minor**: Quick check, runs with inconsequential files
- **Major**: Thorough analysis, runs as additional agent during high-risk review

### Removing Flags

```typescript
reviewStore.removeExpertFlag(
  reviewId,
  'src/auth/login.ts',
  'security'
)
```

## Integration with Review Workflow

### Standard Workflow (No Expert Flags)

1. **Classification**: AI classifies files as inconsequential/high-risk
2. **User Review**: You confirm or adjust classifications
3. **Inconsequential Review**: Bulk review of low-risk files
4. **High-Risk Review**: Multi-agent review of critical files (3 agents + coordinator + accuracy checker)

### With Expert Flags

1. **Classification**: AI classifies files
2. **User Review**: You confirm classifications + **add expert flags**
3. **Inconsequential Review**: Bulk review + **minor-priority expert reviews**
4. **High-Risk Review**: Multi-agent review + **major-priority expert reviews**

### Example: Flagging an Auth File

```typescript
// You're reviewing classifications and see "src/auth/login.ts"
// This is already marked as "high-risk", but you want extra security review

reviewStore.addExpertFlag(
  reviewId,
  'src/auth/login.ts',
  'security',
  'major'  // Will run during high-risk review stage
)

// The security expert will run as an additional specialized agent
// alongside the 3 general reviewers
```

### Example: Flagging a UI Component

```typescript
// "src/components/UserProfile.tsx" is classified as "inconsequential"
// But you want to ensure good UX

reviewStore.addExpertFlag(
  reviewId,
  'src/components/UserProfile.tsx',
  'ui',
  'minor'  // Quick check during inconsequential review
)
```

## Backend Integration

When implementing expert reviewers in your backend, here's how they integrate:

### For Minor-Priority Flags (Inconsequential Files)

```typescript
// During inconsequential review, check for expert flags
const fileClassifications = review.classifications.filter(c =>
  c.riskLevel === 'inconsequential'
)

for (const classification of fileClassifications) {
  // Check if file has expert flags
  if (classification.expertFlags) {
    for (const flag of classification.expertFlags) {
      if (flag.priority === 'minor') {
        // Run the appropriate expert reviewer
        const prompt = getExpertPrompt(flag.reviewerType, classification.file)
        const findings = await runExpertReview(prompt)
        // Add findings to inconsequentialFindings
      }
    }
  }
}
```

### For Major-Priority Flags (High-Risk Files)

```typescript
// During high-risk review, check for expert flags
const fileClassification = review.classifications.find(c =>
  c.file === currentHighRiskFile
)

if (fileClassification?.expertFlags) {
  const majorFlags = fileClassification.expertFlags.filter(f => f.priority === 'major')

  // Run expert reviews AFTER the 3 general reviewers
  for (const flag of majorFlags) {
    const prompt = getExpertPrompt(flag.reviewerType, currentHighRiskFile)
    const findings = await runExpertReview(prompt)
    // Add findings to highRiskFindings
  }
}
```

## Prompt Templates

All expert reviewer prompts are defined in `REVIEW_PROMPTS.md` under "Stage 4: Expert Reviewer Prompts".

Each prompt template uses these variables:
- `{{FILE_PATH}}` - Relative file path
- `{{GIT_DIFF}}` - Git diff output for the file
- `{{FULL_FILE_CONTENT}}` - Complete file contents

Example prompt retrieval:

```typescript
function getExpertPrompt(reviewerType: ExpertReviewerType, file: string): string {
  const prompts = {
    security: SECURITY_EXPERT_PROMPT,
    ui: UI_UX_EXPERT_PROMPT,
    performance: PERFORMANCE_EXPERT_PROMPT,
    accessibility: ACCESSIBILITY_EXPERT_PROMPT,
    database: DATABASE_EXPERT_PROMPT,
  }

  const template = prompts[reviewerType]
  const diff = execSync(`git diff HEAD -- ${file}`, { cwd: projectPath }).toString()
  const content = fs.readFileSync(path.join(projectPath, file), 'utf-8')

  return template
    .replace('{{FILE_PATH}}', file)
    .replace('{{GIT_DIFF}}', diff)
    .replace('{{FULL_FILE_CONTENT}}', content)
}
```

## Usage Cost Awareness

Expert reviewers use additional AI calls. Here's what runs:

### Without Expert Flags
- 1 classification call (all files)
- 1 inconsequential bulk review
- For each high-risk file: 3 reviewers + 1 coordinator + N accuracy checkers

### With Expert Flags
- **+ 1 call per minor-priority flag** (during inconsequential review)
- **+ 1 call per major-priority flag** (during high-risk review)

**Example**: 5 files, 2 high-risk, 1 security flag (major), 1 UI flag (minor)
- Base: 1 classification + 1 inconsequential + (2 files × 3 reviewers) + 2 coordinators = ~10 calls
- With flags: +2 expert calls = ~12 calls total

**Recommendation**: Only flag files that truly need specialized review. The general high-risk review is already thorough.

## Best Practices

1. **Be Selective**: Don't flag every file. Use for truly critical areas.
2. **Security First**: Always flag auth, payment, crypto, and sensitive data handling.
3. **UI for User-Facing**: Flag customer-facing components and complex interactions.
4. **Performance for Scale**: Flag database-heavy operations and high-traffic endpoints.
5. **Accessibility for Public Sites**: Flag any user-facing forms and navigation.
6. **Database for Migrations**: Always flag schema changes and migrations.

## TypeScript Types

```typescript
// Expert reviewer types
export type ExpertReviewerType = 'security' | 'ui' | 'performance' | 'accessibility' | 'database'

// Expert review flag
export interface ExpertReviewFlag {
  file: string
  reviewerType: ExpertReviewerType
  priority: 'minor' | 'major'
}

// File classification with optional expert flags
export interface FileClassification {
  file: string
  riskLevel: FileRiskLevel
  reasoning: string
  expertFlags?: ExpertReviewFlag[]
}
```

## Future Enhancements

Possible additions (not implemented):
- Custom expert reviewers (user-defined prompts)
- Auto-suggest expert flags based on file content (opt-in)
- Expert review history tracking
- Team-level default flags (e.g., always security review auth files)
- Budget limits (max N expert reviews per session)
