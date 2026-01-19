# FileId Migration Status

## ✅ Completed

### 1. Core Infrastructure
- ✅ Created `src/lib/file-id.ts` with FileId utilities
  - `generateFileId(projectId, relativePath)` - Creates stable "projectId:relativePath" identifier
  - `generateCacheKey(fileId, contentHash)` - Creates versioned cache key
  - `cacheKeyMatchesFileId(cacheKey, fileId)` - For prefix matching
  - `parseFileId()`, `parseCacheKey()` - Parsing utilities
  - Path normalization for cross-platform support

### 2. Type System Updates (review-store.ts)
- ✅ Updated `ReviewFinding` to include `fileId: FileId`
- ✅ Updated `FileReviewCache` to include `fileId` and `cacheKey`
- ✅ Updated `FileClassification` to include `fileId`
- ✅ Updated `ExpertReviewFlag` to include `fileId`

### 3. Cache System Refactor (review-store.ts)
- ✅ `getCachedFileReview(fileId, contentHash)` - Uses FileId+hash for lookup
- ✅ `setCachedFileReview(cache)` - Stores with cacheKey
- ✅ `clearCacheForFile(fileId)` - Clears ALL versions of ONE file (bulletproof!)
- ✅ `clearCacheForFiles(fileIds[])` - Clears ALL versions of MULTIPLE files

**Key Improvement**: Cache clearing now uses FileId prefix matching, so it's IMPOSSIBLE to miss cached versions.

## 🔄 In Progress / TODO

### 4. Component Updates

#### GitTab.tsx (CRITICAL - This is where duplicates happen!)
**Current issues:**
- Uses `currentFileHashes: Record<string, string>` - path-based lookup
- Event listeners use file paths to cache findings
- No deduplication by FileId

**Needs:**
```typescript
// Replace currentFileHashes with FileId-based map
const [fileMetadata, setFileMetadata] = useState<Map<FileId, FileMetadata>>(new Map())

// When starting review:
const fileId = generateFileId(projectPath, relativePath)
const metadata = createFileMetadata(projectPath, relativePath, hash)
fileMetadata.set(fileId, metadata)

// When caching findings:
const fileId = finding.fileId  // Use FileId from finding, not file path!
const metadata = fileMetadata.get(fileId)
if (metadata) {
  const cacheKey = generateCacheKey(fileId, metadata.currentHash)
  setCachedFileReview({
    cacheKey,
    fileId,
    file: metadata.relativePath,
    contentHash: metadata.currentHash,
    classification: ...,
    findings: ...,
    reviewedAt: Date.now(),
    projectId: metadata.projectId
  })
}

// When clearing cache (Start Over):
const fileIds = Array.from(fileMetadata.keys())
clearCacheForFiles(fileIds)  // This clears ALL versions!
```

#### ReviewPanel.tsx
**Needs:**
- Update file comparisons to use `fileId` instead of `file` path
- Use `isSameFile(finding1.fileId, finding2.fileId)` for duplicate detection
- Pass `fileId` when calling cache operations

### 5. AI Integration (electron/main.ts)

#### Classification Prompt
```typescript
// Add fileId to each file in prompt
{
  "files": [
    {
      "fileId": "project:src/app.tsx",  // NEW
      "path": "src/app.tsx",
      "diff": "..."
    }
  ]
}

// Expect fileId in response
{
  "classifications": [
    {
      "fileId": "project:src/app.tsx",  // NEW - for exact matching!
      "riskLevel": "high-risk",
      "reasoning": "..."
    }
  ]
}
```

#### Review Prompts (low-risk & high-risk)
```typescript
// Add fileId to each file
{
  "files": [
    {
      "fileId": "project:src/app.tsx",
      "path": "src/app.tsx",
      "diff": "..."
    }
  ]
}

// Expect fileId in findings
{
  "findings": [
    {
      "fileId": "project:src/app.tsx",  // Must match input!
      "line": 42,
      "severity": "warning",
      ...
    }
  ]
}
```

#### Backend Processing
```typescript
// When receiving classifications from AI:
classifications.forEach(classification => {
  // VALIDATE fileId exists in input
  if (!knownFileIds.includes(classification.fileId)) {
    console.error('AI returned unknown fileId:', classification.fileId)
    return
  }
  // Store with fileId as key
})

// When receiving findings from AI:
findings.forEach(finding => {
  // VALIDATE fileId
  if (!knownFileIds.includes(finding.fileId)) {
    console.error('AI returned unknown fileId:', finding.fileId)
    return
  }
  // Add unique finding ID that includes fileId
  finding.id = `${finding.fileId}-${findingIndex}`
})
```

### 6. preload.ts Updates
- Event payloads should include FileId for each finding/classification
- Frontend can trust FileId for all operations

## Expected Outcomes

### Duplicate Prevention
**Before:** Files could be duplicated because:
- Hash mismatch between cache store and lookup
- Path variations (relative vs absolute)
- Multiple cache entries with different hashes not cleaned up

**After:**
- FileId is the ONLY identifier used for deduplication
- `clearCacheForFile(fileId)` removes ALL versions (all hashes)
- Components compare using `isSameFile(fileId1, fileId2)`

### Cache Reliability
**Before:** Cache clearing was unreliable:
```typescript
// Had to iterate ALL cache entries to find matches
for (const [key, cache] of entries()) {
  if (cache.projectId === projectId && cache.file === file) {
    delete(key)  // Might miss entries due to path variations!
  }
}
```

**After:** Cache clearing is bulletproof:
```typescript
// Direct prefix match - can't miss!
for (const [cacheKey] of entries()) {
  if (cacheKeyMatchesFileId(cacheKey, fileId)) {
    delete(cacheKey)  // Guaranteed to find all versions
  }
}
```

### AI Reliability
**Before:** AI responses matched by file path (fragile)
**After:** AI responses include FileId (exact match, no ambiguity)

## Next Steps

1. **Update GitTab.tsx** (highest priority - fixes duplicates)
   - Replace `currentFileHashes` with `fileMetadata: Map<FileId, FileMetadata>`
   - Generate FileId for each file when starting review
   - Use FileId in all cache operations
   - Update event listeners to use FileId

2. **Update electron/main.ts** (fixes AI integration)
   - Add FileId to classification prompts
   - Add FileId to review prompts
   - Validate FileId in AI responses
   - Include FileId in findings sent to frontend

3. **Update ReviewPanel.tsx** (improves UX)
   - Use FileId for all file comparisons
   - Use FileId for duplicate detection

4. **Test & Verify**
   - Test cache clearing with "Start Over"
   - Test duplicate detection
   - Test file tracking across content changes
   - Test with files that have same name in different directories
