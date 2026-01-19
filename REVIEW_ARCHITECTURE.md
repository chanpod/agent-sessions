# Review Architecture Redesign

## Problem Statement
The current review system has multiple points of failure:
1. **Hash confusion**: Hashes change with file content, making it hard to track the same file across reviews
2. **State fragmentation**: File state is scattered across multiple places (cache keys, currentFileHashes, review objects)
3. **Cache invalidation issues**: Clearing reviews doesn't reliably clear all associated state
4. **Duplicate detection failures**: No single source of truth for "which file is this?"

## New Architecture: FileId-Based System

### Core Concept: Stable File Identity
Every file gets a **stable, permanent FileId** that persists across all reviews, regardless of content changes.

```typescript
// Stable identifier for a file within a project
type FileId = string  // Format: "projectId:relativePath"
// Example: "/home/user/myproject:src/app.tsx"
```

### Key Principles

1. **Single Source of Truth**: FileId uniquely identifies a file
2. **Content Tracking**: Hash tracks content version, but FileId tracks file identity
3. **Simple Cache Keys**: Cache key = `fileId:contentHash`
4. **Bulletproof Clearing**: Delete all cache entries matching `fileId:*`

### Data Flow

```
File Detection → FileId Generation → Review Session → Findings Storage
                      ↓
                  (stable ID)
                      ↓
              All subsequent operations use FileId
```

### New Data Structures

#### 1. FileMetadata (replaces scattered file info)
```typescript
interface FileMetadata {
  fileId: FileId                    // Stable: "projectId:relativePath"
  projectId: string                 // Project path
  relativePath: string              // Relative to project root
  currentHash: string               // Current content hash (git diff hash)
  lastReviewedHash?: string         // Hash from last review
  lastReviewedAt?: number           // Timestamp
}
```

#### 2. ReviewSession (replaces ActiveReview + ReviewResult)
```typescript
interface ReviewSession {
  sessionId: string                 // Unique session ID
  projectId: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'

  // Files in this session, indexed by FileId
  files: Map<FileId, FileMetadata>

  // Classifications indexed by FileId
  classifications: Map<FileId, FileClassification>

  // Findings indexed by FileId
  findings: Map<FileId, ReviewFinding[]>
}
```

#### 3. ReviewCache (replaces FileReviewCache)
```typescript
interface ReviewCache {
  // Cache key: "fileId:contentHash"
  cacheKey: string
  fileId: FileId
  contentHash: string
  classification: FileClassification
  findings: ReviewFinding[]
  cachedAt: number
}
```

### Cache Operations

#### Store Finding
```typescript
// Old: setCachedFileReview(projectId, file, hash, findings)
// New:
const fileId = generateFileId(projectId, relativePath)
const cacheKey = `${fileId}:${contentHash}`
cache.set(cacheKey, { fileId, contentHash, findings, ... })
```

#### Lookup Finding
```typescript
// Old: getCachedFileReview(projectId, file, hash) - hash might be wrong!
// New:
const fileId = generateFileId(projectId, relativePath)
const cacheKey = `${fileId}:${contentHash}`
return cache.get(cacheKey)
```

#### Clear All Reviews for File
```typescript
// Old: Iterate through ALL cache entries looking for matching projectId and file
// New: Direct deletion using prefix
const fileId = generateFileId(projectId, relativePath)
cache.deletePrefix(fileId)  // Deletes "fileId:*"
```

### AI Integration

All AI prompts and responses include FileId:

```typescript
// Classification prompt
{
  "files": [
    {
      "fileId": "project:src/app.tsx",
      "path": "src/app.tsx",
      "diff": "..."
    }
  ]
}

// AI response
{
  "classifications": [
    {
      "fileId": "project:src/app.tsx",
      "riskLevel": "high-risk",
      "reasoning": "..."
    }
  ]
}

// Findings
{
  "findings": [
    {
      "fileId": "project:src/app.tsx",
      "line": 42,
      "severity": "warning",
      ...
    }
  ]
}
```

### Benefits

1. ✅ **No duplicate detection needed**: FileId is the deduplication key
2. ✅ **Reliable cache clearing**: Delete all entries with fileId prefix
3. ✅ **File tracking across reviews**: Same FileId = same file, different hashes = different versions
4. ✅ **Simple state management**: Single Map<FileId, T> for each data type
5. ✅ **AI knows exact file**: No ambiguity in prompts/responses

### Migration Path

1. Add FileId generation utility
2. Update ReviewStore to use new data structures
3. Update cache operations to use FileId-based keys
4. Update AI prompt builders to include FileId
5. Update AI response parsers to extract FileId
6. Update UI components to use FileId for lookups

### Implementation Plan

**Phase 1: Core Types & Utilities**
- Define FileId type
- Create generateFileId() utility
- Create FileMetadata builder

**Phase 2: Store Refactor**
- Migrate ReviewStore to use Maps keyed by FileId
- Update all cache operations
- Add cache prefix deletion

**Phase 3: AI Integration**
- Update prompt builders to include FileId
- Update response parsers to extract FileId
- Validate FileId in all findings

**Phase 4: UI Updates**
- Update components to use FileId for lookups
- Remove all path-based comparisons
- Use FileId for all duplicate detection

**Phase 5: Testing & Cleanup**
- Test cache clearing
- Test duplicate detection
- Remove old hash-based state
