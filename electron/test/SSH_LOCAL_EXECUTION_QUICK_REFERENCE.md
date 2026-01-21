# SSH/Local Execution Pattern - Quick Reference

## Running Tests

```bash
# Run SSH/Local tests only
pnpm test electron/test/ssh-local-execution.test.ts

# Run all tests
pnpm test

# Watch mode
pnpm test -- --watch

# With coverage
pnpm test -- --coverage
```

## Pattern at a Glance

```typescript
// Every handler follows this structure:
if (projectId && sshManager) {
  const status = sshManager.getProjectMasterStatus(projectId)
  if (status.connected) {
    try {
      // Try SSH
      const result = await sshManager.execViaProjectMaster(projectId, cmd)
      return { success: true, ...result }
    } catch (err) {
      console.error('[handler] SSH failed:', err)
      return { success: false, error: String(err) }
    }
  }
}
// Fall back to local
const result = performLocalOperation()
return { success: true, ...result }
```

## Decision Tree

```
projectId && sshManager?
├─ Yes: status.connected?
│  ├─ Yes: Try SSH
│  │  ├─ Success → Return SSH result
│  │  └─ Error → Log & return error
│  └─ No: Use local
└─ No: Use local
```

## Test Scenarios

### Must Test
1. ✅ SSH success (projectId + sshManager + connected)
2. ✅ Local: no projectId
3. ✅ Local: no sshManager
4. ✅ Local: not connected
5. ✅ SSH error (log + return error)

### Handler-Specific
- **fs:readFile**: file size, directory check, content reading
- **fs:listDir**: directory check, sorting, empty handling

## Common Mocks

```typescript
// SSH manager mock
mockSshManager = {
  getProjectMasterStatus: vi.fn(),
  execViaProjectMaster: vi.fn(),
}

// Connected state
mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })

// SSH success
mockSshManager.execViaProjectMaster.mockResolvedValue('result')

// SSH error
mockSshManager.execViaProjectMaster.mockRejectedValue(new Error('fail'))

// Local fs mocks
vi.mocked(fs.existsSync).mockReturnValue(true)
vi.mocked(fs.statSync).mockReturnValue(mockStats)
vi.mocked(fs.readFileSync).mockReturnValue('content')
```

## Verification Checklist

```typescript
// Verify SSH was used
expect(mockSshManager.getProjectMasterStatus).toHaveBeenCalled()
expect(mockSshManager.execViaProjectMaster).toHaveBeenCalled()
expect(fs.existsSync).not.toHaveBeenCalled()

// Verify local was used
expect(fs.existsSync).toHaveBeenCalled()
expect(mockSshManager.execViaProjectMaster).not.toHaveBeenCalled()

// Verify error logging
expect(console.error).toHaveBeenCalledWith('[handler] SSH failed:', error)

// Verify result format
expect(result.success).toBe(true)
expect(result).toHaveProperty('content') // or 'items' for listDir
```

## Files

| File | Purpose |
|------|---------|
| `ssh-local-execution.test.ts` | Test suite (24 tests) |
| `SSH_LOCAL_EXECUTION_DOCUMENTATION.md` | Full documentation |
| `SSH_LOCAL_EXECUTION_TEST_SUMMARY.md` | Test coverage summary |
| `SSH_LOCAL_EXECUTION_QUICK_REFERENCE.md` | This file |

## Key Handlers Using Pattern

Located in `electron/main.ts`:
- `fs:readFile` (line 2021)
- `fs:listDir` (line 2119)
- Multiple git handlers (various lines)

## When Modifying Pattern

1. Update handler in `electron/main.ts`
2. Update tests in `ssh-local-execution.test.ts`
3. Run tests: `pnpm test`
4. Update documentation if needed
5. Verify all 24+ tests pass

## Common Issues

| Issue | Solution |
|-------|----------|
| Test fails: "SSH not called" | Check projectId, sshManager, and connected status are all set |
| Test fails: "Local not called" | Ensure one of: no projectId, no sshManager, or not connected |
| Mock not working | Call `vi.clearAllMocks()` in `beforeEach` |
| Error not logged | Verify `console.error` spy is set up |

## Expected Test Results

```
✅ 24 tests passing
⏱️ ~16-21ms execution time
📊 100% decision point coverage
🎯 All error scenarios covered
```

## Quick Debug

```typescript
// Add this to see what's being called
console.log('projectId:', projectId)
console.log('sshManager:', sshManager)
console.log('status:', mockSshManager.getProjectMasterStatus.mock.results)
console.log('execVia calls:', mockSshManager.execViaProjectMaster.mock.calls)
```

## Need More Info?

- **Full docs**: `SSH_LOCAL_EXECUTION_DOCUMENTATION.md`
- **Test details**: `SSH_LOCAL_EXECUTION_TEST_SUMMARY.md`
- **Implementation**: `electron/main.ts` (lines 2021+, 2119+)
