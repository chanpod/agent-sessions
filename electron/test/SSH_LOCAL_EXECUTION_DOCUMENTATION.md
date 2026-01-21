# SSH/Local Execution Fallback Pattern Documentation

## Overview

This document describes the SSH/Local execution fallback pattern used throughout `electron/main.ts` for IPC handlers that can operate via SSH or fall back to local file system operations.

## Pattern Location

The pattern is implemented in multiple IPC handlers in `electron/main.ts`:

- `fs:readFile` (lines 2021-2102)
- `fs:listDir` (lines 2119-2200)
- Multiple git handlers (lines 1098, 1281, 1368, 1433, 1483, 1522, 1764, 1867, 1944, 2026, 2124, 2228)

## Pattern Structure

```typescript
// IPC Handler Pattern
ipcMain.handle('handler:name', async (_event, path: string, projectId?: string) => {
  try {
    // 1. Check if SSH is available and connected
    if (projectId && sshManager) {
      const status = sshManager.getProjectMasterStatus(projectId)
      if (status.connected) {
        try {
          // 2. Execute via SSH
          const result = await sshManager.execViaProjectMaster(projectId, 'command')
          return { success: true, ...result }
        } catch (err) {
          // 3. Log SSH failure
          console.error('[handler:name] SSH command failed:', err)
          // 4. Return error or fall through to local (handler-specific)
          return { success: false, error: String(err) }
        }
      }
    }

    // 5. Local execution fallback
    const localResult = performLocalOperation(path)
    return { success: true, ...localResult }
  } catch (err) {
    console.error('Failed to perform operation:', err)
    return { success: false, error: String(err) }
  }
})
```

## Decision Tree

```
                    Start
                      |
         +-----------+------------+
         |                        |
    projectId exists?        No projectId
         |                        |
    +----+----+                   |
    |         |                   |
 sshManager   No sshManager       |
   exists?         |               |
    |         |                   |
    +----+----+                   |
         |                        |
  status.connected?               |
         |                        |
    +----+----+                   |
    |         |                   |
   Yes       No                   |
    |         |                   |
 Try SSH     +-------------------+
    |                            |
    +--------+                   |
    |        |                   |
 Success   Error                 |
    |        |                   |
 Return   Log Error              |
           |                     |
           +---------------------+
                                 |
                          Local Execution
                                 |
                              Return
```

## Decision Points

### 1. ProjectId Check
- **Condition**: `if (projectId && sshManager)`
- **Purpose**: Determine if SSH execution is even possible
- **Outcomes**:
  - Both exist → Check connection status
  - Either missing → Go directly to local execution

### 2. Connection Status Check
- **Condition**: `if (status.connected)`
- **Purpose**: Verify SSH tunnel is active
- **Outcomes**:
  - Connected → Try SSH execution
  - Disconnected → Go to local execution

### 3. SSH Execution
- **Operation**: `await sshManager.execViaProjectMaster(projectId, command)`
- **Purpose**: Execute the operation on remote system via SSH
- **Outcomes**:
  - Success → Return result
  - Error → Log and handle (return error or fall through)

### 4. Error Handling
- **Purpose**: Gracefully handle SSH failures
- **Actions**:
  - Log error with handler-specific prefix
  - Return error response (in most handlers)
  - Some handlers may fall through to local execution

### 5. Local Execution
- **Purpose**: Execute operation on local file system
- **When**:
  - No projectId provided
  - No sshManager available
  - SSH not connected
  - (Rarely) SSH execution failed and handler falls through

## Handler-Specific Behaviors

### fs:readFile

**SSH Path**:
1. Check file exists via `stat` command
2. Verify file size (<5MB)
3. Read content via `cat` command
4. Return content with metadata

**Local Path**:
1. Check file exists via `fs.existsSync()`
2. Get stats via `fs.statSync()`
3. Verify not a directory
4. Verify size (<5MB)
5. Read content via `fs.readFileSync()`
6. Return content with metadata

**Error Handling**: Returns error immediately on SSH failure (does not fall through to local)

### fs:listDir

**SSH Path**:
1. Execute `ls -1Ap` to list directory
2. Parse output to identify directories (ending with `/`) and files
3. Create entry objects with path, name, and type
4. Sort: directories first, then files, alphabetically
5. Return entries

**Local Path**:
1. Check directory exists via `fs.existsSync()`
2. Verify is directory via `fs.statSync()`
3. Read entries via `fs.readdirSync({ withFileTypes: true })`
4. Map to entry objects
5. Sort: directories first, then files, alphabetically
6. Return entries

**Error Handling**: Returns error immediately on SSH failure (does not fall through to local)

## Test Coverage

The test suite in `electron/test/ssh-local-execution.test.ts` covers:

### SSH Execution Scenarios
- ✅ SSH success when projectId, sshManager, and connection exist
- ✅ SSH file not found handling
- ✅ SSH file/directory too large handling
- ✅ SSH command execution and result parsing
- ✅ SSH directory listing and sorting

### Local Fallback Scenarios
- ✅ Local execution when no projectId provided
- ✅ Local execution when no sshManager exists
- ✅ Local execution when status.connected is false
- ✅ Local file not found handling
- ✅ Local directory validation
- ✅ Local file size limits
- ✅ Local directory listing and sorting

### Error Handling Scenarios
- ✅ SSH connection errors logged correctly
- ✅ Error messages properly formatted
- ✅ Console.error calls verified
- ✅ Error responses match expected format

### Decision Tree Scenarios
- ✅ Complete decision tree traversal for SSH success
- ✅ Decision tree to local when projectId missing
- ✅ Decision tree to local when sshManager missing
- ✅ Decision tree to local when not connected
- ✅ Decision tree to error when SSH throws

## Key Implementation Details

### 1. Path Handling
- SSH paths use POSIX format (`/remote/path`)
- Local paths may be Windows format (`C:\local\path`)
- Use `path.posix.join()` for SSH paths
- Use `resolvePathForFs()` for local paths

### 2. Error Logging
- Each handler uses a specific prefix: `[handler:name]`
- SSH errors logged with context: `SSH command failed:`
- General errors logged with action: `Failed to [action]:`

### 3. Return Format
- Success: `{ success: true, ...data }`
- Failure: `{ success: false, error: string }`
- Consistent format across SSH and local paths

### 4. Security Considerations
- File size limits (5MB) applied in both SSH and local paths
- Path sanitization via quote escaping for SSH commands
- Directory validation to prevent file/directory confusion

### 5. Performance
- SSH status checked before attempting connection
- Single `stat` call to check existence and get metadata
- Efficient directory listing with single command

## Testing Strategy

### Unit Tests
- Mock SSH manager with `vi.fn()`
- Mock fs operations with `vi.mock('fs')`
- Test each decision point independently
- Verify both positive and negative cases

### Integration Points
- Test the full decision tree flow
- Verify error propagation
- Ensure logging happens correctly
- Validate return value formats

### Edge Cases
- Empty directories
- Missing files/directories
- Permission errors (via mocked rejections)
- Connection state changes
- Large files (>5MB limit)

## Usage Examples

### Testing SSH Success
```typescript
mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
mockSshManager.execViaProjectMaster.mockResolvedValue('result')

const result = await handler('/path', 'project-id', mockSshManager)

expect(result.success).toBe(true)
expect(mockSshManager.execViaProjectMaster).toHaveBeenCalled()
```

### Testing Local Fallback
```typescript
vi.mocked(fs.existsSync).mockReturnValue(true)
vi.mocked(fs.readFileSync).mockReturnValue('content')

const result = await handler('/path') // No projectId

expect(result.success).toBe(true)
expect(fs.readFileSync).toHaveBeenCalled()
```

### Testing Error Handling
```typescript
mockSshManager.getProjectMasterStatus.mockReturnValue({ connected: true })
mockSshManager.execViaProjectMaster.mockRejectedValue(new Error('SSH failed'))

const result = await handler('/path', 'project-id', mockSshManager)

expect(result.success).toBe(false)
expect(console.error).toHaveBeenCalledWith('[handler] SSH command failed:', expect.any(Error))
```

## Maintenance Notes

### When Adding New Handlers
1. Follow the standard pattern structure
2. Add handler-specific error prefix
3. Implement appropriate size/validation checks
4. Add tests for both SSH and local paths
5. Document handler-specific behaviors

### When Modifying Pattern
1. Update all handlers consistently
2. Update test suite to match changes
3. Update this documentation
4. Test both SSH and local execution paths
5. Verify error handling still works

### Common Pitfalls
- Forgetting to check `status.connected`
- Not logging SSH errors before falling back
- Inconsistent return value formats
- Missing size/validation checks in one path
- Not handling both POSIX and Windows paths

## Related Files

- **Implementation**: `electron/main.ts`
- **Tests**: `electron/test/ssh-local-execution.test.ts`
- **SSH Manager**: (referenced but not in this codebase)
- **Path Resolution**: `resolvePathForFs()` in `electron/main.ts`

## Performance Considerations

### SSH Path
- Network latency: 10-1000ms per command
- Two commands for file read (stat + cat)
- Single command for directory listing
- Connection reuse via master tunnel

### Local Path
- File system access: <1ms typically
- Direct fs operations
- No network overhead
- OS-level caching benefits

### Optimization Opportunities
- Cache SSH connection status (already done)
- Batch SSH commands when possible
- Implement parallel SSH operations
- Consider streaming for large files (future)

## Security Considerations

### SSH Command Injection Prevention
- All paths are quote-escaped: `path.replace(/"/g, '\\"')`
- Commands use double quotes to preserve spaces
- No user input directly interpolated without escaping

### File Access Control
- File size limits prevent memory exhaustion
- Directory validation prevents confused deputy attacks
- Error messages don't leak sensitive path information
- SSH execution happens in project context only

### Best Practices
- Always validate file types (file vs directory)
- Apply size limits consistently
- Sanitize all path inputs
- Log errors without sensitive details
- Use read-only operations when possible
