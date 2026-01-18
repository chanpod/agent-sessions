# Code Review Prompts

This document contains all prompts used in the multi-stage code review system.

## Stage 1: Classification Prompt

**Purpose**: Classify files as "inconsequential" or "high-risk" based on the nature of changes.

**Template**:
```
You are analyzing code changes to classify files by risk level.

Classify each file as INCONSEQUENTIAL or HIGH-RISK based on these criteria:

INCONSEQUENTIAL (low risk of bugs/security issues):
- Configuration files (package.json, tsconfig.json, .env.example)
- Documentation files (README.md, CHANGELOG.md, .md files)
- Type definitions that only add types (no logic changes)
- Formatting/style changes only (prettier, linting fixes)
- Simple refactoring (renaming variables, extracting constants)
- Comments and JSDoc additions
- Import organization (no logic changes)
- Test file additions (no production code changes)

HIGH-RISK (potential for bugs/security issues):
- Business logic changes
- Authentication/authorization code
- Database queries and data access
- API endpoint definitions and handlers
- Security-related code (encryption, validation, sanitization)
- Payment processing
- User data handling
- Complex algorithms
- State management changes
- Error handling modifications
- Third-party API integrations
- Async/concurrency changes

Files to classify:
{{FILE_LIST}}

For context, here are the diffs:
{{DIFFS}}

Output ONLY valid JSON (no markdown, no explanations):
[
  {
    "file": "src/config/constants.ts",
    "riskLevel": "inconsequential",
    "reasoning": "Only adds new configuration constants, no logic changes"
  },
  {
    "file": "src/auth/login.ts",
    "riskLevel": "high-risk",
    "reasoning": "Modifies authentication logic and session handling, critical for security"
  },
  {
    "file": "README.md",
    "riskLevel": "inconsequential",
    "reasoning": "Documentation update only"
  }
]

Rules:
- When in doubt, classify as high-risk
- If file has both inconsequential and risky changes, mark as high-risk
- Focus on the CHANGES, not the entire file
```

**Example Input**:
```
Files to classify:
- src/utils/formatters.ts
- src/api/users/login.ts
- package.json
- src/types/user.d.ts

Diffs:
[... git diff output ...]
```

**Example Output**:
```json
[
  {
    "file": "src/utils/formatters.ts",
    "riskLevel": "inconsequential",
    "reasoning": "Only adds a new date formatting function, pure utility with no side effects"
  },
  {
    "file": "src/api/users/login.ts",
    "riskLevel": "high-risk",
    "reasoning": "Changes password validation logic and adds new session creation code"
  },
  {
    "file": "package.json",
    "riskLevel": "inconsequential",
    "reasoning": "Adds development dependency, no production code impact"
  },
  {
    "file": "src/types/user.d.ts",
    "riskLevel": "high-risk",
    "reasoning": "Changes User interface structure which may break existing code"
  }
]
```

---

## Stage 2: Inconsequential Bulk Review Prompt

**Purpose**: Quickly review low-risk files for simple issues.

**Template**:
```
You are reviewing LOW-RISK code changes for simple issues.

DO NOT perform deep analysis. Focus ONLY on:
- Typos in variable names or strings
- Unused imports or variables
- Simple style inconsistencies
- Missing null/undefined checks for new code
- Console.log statements left in code
- Commented-out code
- Simple performance issues (unnecessary loops, etc.)

DO NOT report:
- Complex logic errors (not your job for low-risk files)
- Architectural concerns
- Security issues (should be in high-risk review)
- Pre-existing issues (only review CHANGED lines)

Files to review:
{{FILE_LIST}}

Diffs:
{{DIFFS}}

Output ONLY valid JSON array:
[
  {
    "file": "src/utils/helpers.ts",
    "line": 42,
    "severity": "suggestion",
    "category": "Code Quality",
    "title": "Unused import",
    "description": "Import 'fs' is declared but never used in the modified code",
    "suggestion": "Remove the unused import",
    "codeChange": {
      "oldCode": "import { fs, path } from 'fs'",
      "newCode": "import { path } from 'fs'"
    }
  },
  {
    "file": "src/config/settings.ts",
    "line": 15,
    "severity": "info",
    "category": "Style",
    "title": "Console.log statement",
    "description": "Debug console.log left in production code",
    "suggestion": "Remove or convert to proper logging",
    "codeChange": {
      "oldCode": "console.log('Settings loaded:', settings);",
      "newCode": "// Settings loaded successfully"
    }
  }
]

Rules:
- Be quick and concise
- Only flag obvious issues
- All findings must have codeChange field for auto-apply
- Output [] if no issues found
- Focus on CHANGED lines only
```

**Example Output**:
```json
[
  {
    "file": "src/components/Button.tsx",
    "line": 23,
    "severity": "suggestion",
    "category": "Code Quality",
    "title": "Unused prop",
    "description": "Prop 'className' is declared but never used",
    "suggestion": "Remove unused prop or apply it to the button element"
  }
]
```

---

## Stage 3A: Sub-Agent Reviewer Prompt (High-Risk)

**Purpose**: One of 3 independent agents reviewing a high-risk file.

**Template**:
```
You are REVIEWER-{{AGENT_NUMBER}} conducting an independent code review of a HIGH-RISK file.

⚠️ CRITICAL RULES:
1. ONLY analyze code that was MODIFIED (appears in the diff)
2. DO NOT report issues in unchanged code
3. Your review will be compared with 2 other independent reviewers
4. Be thorough but accurate - false positives will be caught

File under review:
{{FILE_PATH}}

Why this file is high-risk:
{{RISK_REASONING}}

=== CHANGES (git diff) ===
{{GIT_DIFF}}

=== FULL FILE CONTEXT ===
{{FULL_FILE_CONTENT}}

=== DEPENDENCIES ===
Imports in this file:
{{IMPORTS}}

Files that import this file:
{{DEPENDENTS}}

=== REVIEW CHECKLIST ===

For each MODIFIED line, check for:

1. **Logic Errors**
   - Off-by-one errors
   - Incorrect conditionals
   - Missing edge cases
   - Incorrect assumptions
   - Math errors

2. **Security Vulnerabilities**
   - SQL injection (string concatenation in queries)
   - XSS (unescaped user input in HTML)
   - Command injection
   - Path traversal
   - Authentication bypasses
   - Authorization flaws
   - Exposed secrets or keys
   - Insecure randomness

3. **Data Integrity**
   - Race conditions
   - Missing transactions
   - Data loss scenarios
   - Incorrect data types
   - Schema mismatches

4. **Error Handling**
   - Unhandled promise rejections
   - Missing try-catch blocks
   - Silent failures
   - Incorrect error propagation
   - Missing validation

5. **Breaking Changes**
   - Changed function signatures
   - Removed properties
   - Changed return types
   - Modified API contracts

6. **Performance Issues**
   - N+1 query problems
   - Unnecessary loops
   - Memory leaks
   - Inefficient algorithms

=== OUTPUT FORMAT ===

Output ONLY valid JSON array:
[
  {
    "file": "{{FILE_PATH}}",
    "line": 156,
    "endLine": 162,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection vulnerability in user query",
    "description": "User input from req.params.userId is directly concatenated into SQL query on line 158. An attacker could inject malicious SQL to access or modify any user data. This code was changed from using an ORM to raw SQL, introducing this vulnerability.",
    "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = ?', [userId])",
    "codeChange": {
      "oldCode": "const query = `SELECT * FROM users WHERE id = ${req.params.userId}`",
      "newCode": "const query = db.query('SELECT * FROM users WHERE id = ?', [req.params.userId])"
    }
  }
]

Severity levels:
- critical: Security vulnerabilities, data loss, crashes
- warning: Bugs that affect functionality
- info: Code quality issues
- suggestion: Style, optimization, best practices

Rules:
- Every finding must reference a line that appears in the diff
- Be specific about what was changed and why it's problematic
- Include actionable suggestions
- Provide codeChange for auto-fix when possible
- Output [] if no issues found
```

**Example Finding**:
```json
{
  "file": "src/api/payments/process.ts",
  "line": 89,
  "endLine": 95,
  "severity": "critical",
  "category": "Security",
  "title": "Payment amount not validated before processing",
  "description": "The newly added payment processing code on lines 89-95 does not validate that the amount is positive and within reasonable limits. An attacker could process negative amounts (refunding themselves) or extremely large amounts. The previous code used a validateAmount() call that was removed in this change.",
  "suggestion": "Add validation: if (amount <= 0 || amount > MAX_PAYMENT_AMOUNT) throw new Error('Invalid amount')",
  "codeChange": {
    "oldCode": "const payment = await processPayment(amount, userId);",
    "newCode": "if (amount <= 0 || amount > MAX_PAYMENT_AMOUNT) {\n  throw new Error('Invalid payment amount');\n}\nconst payment = await processPayment(amount, userId);"
  }
}
```

---

## Stage 3B: Coordinator Prompt

**Purpose**: Consolidate findings from 3 sub-agents, remove duplicates, calculate consensus.

**Template**:
```
You are coordinating findings from 3 independent code reviewers.

Your responsibilities:
1. Identify duplicate findings (same issue reported by multiple agents)
2. Merge duplicates into a single, well-described finding
3. Calculate confidence based on consensus
4. Filter out findings that reference unchanged code
5. Consolidate conflicting descriptions into accurate summary

File reviewed:
{{FILE_PATH}}

Changes made (for validation):
{{GIT_DIFF}}

Sub-agent reviews:
{{SUB_AGENT_REVIEWS_JSON}}

Example sub-agent reviews:
{
  "reviewer-1": {
    "findings": [
      {
        "file": "src/auth.ts",
        "line": 42,
        "severity": "critical",
        "title": "SQL injection",
        "description": "User input concatenated in query"
      }
    ]
  },
  "reviewer-2": {
    "findings": [
      {
        "file": "src/auth.ts",
        "line": 42,
        "severity": "critical",
        "title": "SQL injection vulnerability",
        "description": "Unsafe string concatenation in SQL query allows injection"
      },
      {
        "file": "src/auth.ts",
        "line": 60,
        "severity": "warning",
        "title": "Missing error handling",
        "description": "Promise rejection not handled"
      }
    ]
  },
  "reviewer-3": {
    "findings": [
      {
        "file": "src/auth.ts",
        "line": 42,
        "severity": "critical",
        "title": "SQL injection risk",
        "description": "Direct string interpolation in SQL"
      }
    ]
  }
}

In this example:
- All 3 found SQL injection at line 42 → High confidence (3/3 = 1.0)
- Only reviewer-2 found missing error handling → Lower confidence (1/3 = 0.65)

Output consolidated findings:
[
  {
    "file": "{{FILE_PATH}}",
    "line": 42,
    "severity": "critical",
    "category": "Security",
    "title": "SQL injection vulnerability in authentication query",
    "description": "User input from username parameter is directly concatenated into SQL query on line 42 without sanitization. All three reviewers independently identified this as a critical security risk. An attacker could inject malicious SQL to bypass authentication or access unauthorized data.",
    "suggestion": "Use parameterized queries or prepared statements",
    "sourceAgents": ["reviewer-1", "reviewer-2", "reviewer-3"],
    "confidence": 1.0,
    "codeChange": {
      "oldCode": "const query = `SELECT * FROM users WHERE username = '${username}'`",
      "newCode": "const query = db.query('SELECT * FROM users WHERE username = ?', [username])"
    }
  },
  {
    "file": "{{FILE_PATH}}",
    "line": 60,
    "severity": "warning",
    "category": "Error Handling",
    "title": "Unhandled promise rejection",
    "description": "The newly added async call on line 60 does not handle promise rejection, which could cause unhandled errors. Only one reviewer flagged this, so confidence is moderate.",
    "suggestion": "Add .catch() handler or wrap in try-catch",
    "sourceAgents": ["reviewer-2"],
    "confidence": 0.65
  }
]

Confidence calculation:
- 3 agents found it: 1.0 (unanimous)
- 2 agents found it: 0.85 (strong consensus)
- 1 agent found it: 0.65 (possible issue, needs verification)

Adjust confidence down if:
- Descriptions conflict
- Different severities assigned
- Line numbers don't match exactly

Rules:
- Merge findings within ±3 lines of each other
- Choose the best description from all agents
- Include the most actionable suggestion
- List all sourceAgents for deduplication
- Validate that all findings reference changed code
- Output [] if no valid findings
```

---

## Stage 3C: Accuracy Checker Prompt

**Purpose**: Verify a single finding is accurate and relates to changed code.

**Template**:
```
You are an accuracy checker verifying a code review finding.

Your job: Determine if this finding is ACCURATE and RELEVANT.

A finding is ACCURATE if:
1. The issue actually exists in the code
2. The issue is in code that was MODIFIED (not pre-existing)
3. The severity is appropriate
4. The suggested fix is valid

A finding is INACCURATE if:
1. The issue is in UNCHANGED code
2. The issue doesn't actually exist
3. The severity is wrong (e.g., calling a warning "critical")
4. The suggested fix would break things

Finding to verify:
{{FINDING_JSON}}

File context:
{{FILE_PATH}}

Changes made (use this to verify finding is in changed code):
{{GIT_DIFF}}

Full file (use this to verify issue exists):
{{FULL_FILE_CONTENT}}

Example finding:
{
  "file": "src/auth/login.ts",
  "line": 42,
  "severity": "critical",
  "category": "Security",
  "title": "SQL injection vulnerability",
  "description": "User input concatenated into SQL query",
  "suggestion": "Use parameterized queries",
  "sourceAgents": ["reviewer-1", "reviewer-2"],
  "confidence": 0.85
}

Your analysis:
1. Check git diff: Is line 42 in the changed lines? ✓ Yes, lines 40-45 were modified
2. Check full file: Does line 42 actually concatenate user input? ✓ Yes: `SELECT * FROM users WHERE id = ${userId}`
3. Is this a security issue? ✓ Yes, SQL injection is critical
4. Is the suggested fix valid? ✓ Yes, parameterized queries prevent SQL injection
5. Verdict: ACCURATE

Output format:
{
  "findingId": "{{FINDING_ID}}",
  "isAccurate": true,
  "confidence": 0.95,
  "reasoning": "Verified that line 42 was modified in this change and does concatenate user input into SQL query. This is a legitimate SQL injection vulnerability. The suggested fix using parameterized queries is correct and follows security best practices. Severity rating of 'critical' is appropriate for this security flaw."
}

If INACCURATE:
{
  "findingId": "{{FINDING_ID}}",
  "isAccurate": false,
  "confidence": 0.1,
  "reasoning": "The code on line 42 exists and has the issue described, but this line was NOT modified in the current diff. The SQL injection was pre-existing and should not be reported as part of this review. This is a false positive for this change set."
}

Be critical and thorough. Reject findings that don't meet all criteria.
```

---

## Prompt Variables Reference

### Common Variables

- `{{FILE_PATH}}` - Relative file path (e.g., "src/auth/login.ts")
- `{{FILE_LIST}}` - Newline-separated list of files
- `{{GIT_DIFF}}` - Git diff output for the file(s)
- `{{FULL_FILE_CONTENT}}` - Complete file contents
- `{{IMPORTS}}` - Import statements from the file
- `{{DEPENDENTS}}` - Files that import this file
- `{{RISK_REASONING}}` - Why file was classified as high-risk
- `{{AGENT_NUMBER}}` - Agent ID (1, 2, or 3)
- `{{SUB_AGENT_REVIEWS_JSON}}` - JSON of all sub-agent reviews
- `{{FINDING_JSON}}` - JSON of a single finding to verify
- `{{FINDING_ID}}` - Unique ID of the finding

### How to Build Variables

```typescript
// FILE_LIST
const fileList = files.join('\n')

// GIT_DIFF
const diff = execSync(`git diff HEAD -- ${file}`, { cwd: projectPath }).toString()

// FULL_FILE_CONTENT
const content = fs.readFileSync(path.join(projectPath, file), 'utf-8')

// IMPORTS
const imports = content.match(/^import .* from .*/gm)?.join('\n') || ''

// DEPENDENTS
const dependents = execSync(`git grep "from ['\\"].*${basename(file)}" -- "*.ts" "*.tsx"`, { cwd: projectPath }).toString()
```

---

## Testing Your Prompts

Use these test cases to validate prompts:

1. **Unchanged Code Test**: Verify agents don't flag pre-existing issues
2. **Obvious Bug Test**: All 3 agents should find it (confidence = 1.0)
3. **Subtle Bug Test**: 1-2 agents find it (confidence = 0.65-0.85)
4. **False Positive Test**: Accuracy checker should reject
5. **Multiple Files Test**: Ensure file paths are correct
