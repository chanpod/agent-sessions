# Git Change Data Flow Trace - Complete System Analysis

## OVERVIEW

The system tracks git changes from file system level through watchers, state management (Zustand), and UI re-renders.

---

## 1. GIT CHANGE DETECTION (Electron Main Process)

File System Level:
- .git/HEAD    <- Branch changes
- .git/index   <- Staging changes
- .git/refs    <- Commit history changes

Implementation (electron/main.ts lines 1505-1634):
- fs.watch() monitors .git directory
- Debounce: 300ms delay (GIT_DEBOUNCE_MS)
- Stores watcher state in gitWatchers Map
- Validates actual change before notification

---

## 2. IPC EVENT EMISSION

After debounce fires:
- mainWindow.webContents.send('git:changed', projectPath)
- Sends path to renderer process only if change validated

---

## 3. GLOBAL LISTENER SETUP (Zustand Store)

Location: src/stores/git-store.ts (lines 74-86)

CRITICAL: Single global listener for ALL projects
- globalListenerSetup flag ensures listener attached once
- Maps projectPath -> projectId via watchedProjects Map
- Calls refreshGitInfo(projectId) when 'git:changed' fires

---

## 4. STATE UPDATE FLOW

onChanged listener
  -> refreshGitInfo(projectId, projectPath)
    -> window.electron.git.getInfo()           [IPC]
    -> window.electron.git.listBranches()      [IPC]
    -> window.electron.git.getChangedFiles()   [IPC]
      -> setGitInfo(projectId, info)           [Zustand]
        -> gitInfo[projectId] updated in store
          -> All useGitStore() subscribers notified

---

## 5. COMPONENT RE-RENDERS

ProjectHeader.tsx (line 20):
- Subscribes to gitInfo
- Shows branch tabs, branch selector
- Calls watchProject() for all projects

ChangedFilesPanel.tsx (line 35):
- Subscribes to gitInfo
- Shows staged/unstaged files
- Handles stage/unstage/commit operations

ProjectItem.tsx (line 19):
- Subscribes to gitInfo
- Shows project status

---

## 6. COMPLETE DATA FLOW DIAGRAM

File System Event
  ↓
fs.watch() on .git/ directory
  ↓
Debounce timer (300ms)
  ↓
Validation: Check HEAD content and index mtime
  ↓
IPC: mainWindow.webContents.send('git:changed', projectPath)
  ↓
RENDERER PROCESS
  ↓
Global listener: window.electron.git.onChanged()
  ↓
watchedProjects.get(projectPath) -> projectId
  ↓
refreshGitInfo(projectId, projectPath)
  ↓
3x IPC calls: getInfo, listBranches, getChangedFiles
  ↓
Zustand: setGitInfo(projectId, newInfo)
  ↓
gitInfo[projectId] updated in store state
  ↓
Zustand notifies all subscribers
  ↓
ProjectHeader, ChangedFilesPanel, ProjectItem re-render
  ↓
UI updates with new git state

---

## 7. BREAKS IN REACTIVITY - WEAK POINTS

### CRITICAL BREAKS

Break #1: SSH Projects - No Auto-Update
- Location: electron/main.ts line 1518
- Issue: Git watching disabled for SSH projects
- Result: Changes NOT detected, manual refresh required
- Code: if (projectMasterStatus.connected) return { success: false }

Break #2: WSL Projects - No Auto-Update on Windows
- Location: electron/main.ts line 1526
- Issue: fs.watch() unreliable with WSL paths
- Result: Changes NOT detected, manual refresh required
- Code: if (wslInfo.isWslPath) return { success: false }

### HIGH SEVERITY BREAKS

Break #3: Global Listener Race Condition
- Location: git-store.ts lines 75-86
- Issue: globalListenerSetup flag timing-dependent
- Risk: Events lost if listener not attached in time
- Multiple rapid watchProject() calls could race

Break #4: Path Normalization Mismatch
- Location: git-store.ts line 80: watchedProjects.get(changedPath)
- Issue: No path normalization, Windows backslashes vs forward slashes
- Risk: Git changes silently ignored if path keys don't match exactly
- Symlinks and relative vs absolute paths could mismatch

Break #5: No Component Unmount Cleanup
- Location: ProjectHeader.tsx lines 37-52
- Issue: useEffect calls watchProject() but has no cleanup
- Risk: Memory leak, duplicate listeners on component remount
- Listeners accumulate but never removed

### MEDIUM SEVERITY BREAKS

Break #6: Manual Refresh After Git Operations
- Location: ChangedFilesPanel.tsx lines 330-375
- Issue: handleStageFile/handleCommit manually call handleRefreshGitInfo()
- Impact: No auto-update after user actions, 300ms lag

Break #7: Debounce Timer State Not Cleared
- Location: electron/main.ts lines 1562-1602
- Issue: Orphaned timers if watcher closed during debounce
- Risk: Memory leak, race condition (timer fires after window destroyed)

Break #8: Stale watchedProjects Map Entries
- Location: git-store.ts lines 88-96
- Issue: unwatchProject() may not be called when projects removed
- Risk: Wrong project refreshed, memory leak

---

## 8. SUMMARY TABLE

| Break | Severity | Issue | Component | Impact |
|-------|----------|-------|-----------|--------|
| SSH no auto-update | CRITICAL | Watcher disabled | electron/main | Changes not detected |
| WSL no auto-update | CRITICAL | Watcher disabled | electron/main | Changes not detected |
| Listener race | HIGH | Timing | git-store | Events lost on rapid watch |
| Path mismatch | HIGH | No normalize | git-store | Events silently ignored |
| No cleanup | HIGH | Memory leak | ProjectHeader | Duplicate listeners |
| Manual refresh | MEDIUM | UX lag | ChangedFilesPanel | Stale UI shown |
| Timer orphans | MEDIUM | Memory leak | electron/main | Memory leak + race |
| Stale map | MEDIUM | State | git-store | Wrong project updates |

---

## 9. KEY WEAK POINT CHAIN

The most critical reactive chain has these breaks:

1. User stages file (handleStageFile)
2. IPC: window.electron.git.stageFile()
3. [MUST CALL handleRefreshGitInfo() manually - NO AUTO-UPDATE]
4. handleRefreshGitInfo waits for IPC response
5. setGitInfo triggers store update
6. Components re-render

OR (if relies on fs.watch):

1. git index file modified
2. fs.watch fires event
3. [BREAK: Disabled for SSH/WSL projects]
4. Debounce: 300ms delay
5. Validation checks HEAD/index
6. [BREAK: Path mismatch possible]
7. Global listener fires
8. [BREAK: Race condition on setup]
9. watchedProjects lookup
10. refreshGitInfo called
11. Components re-render

---

## 10. FILES INVOLVED

- electron/main.ts - Watcher, fs.watch, git:watch handler
- src/stores/git-store.ts - Global listener, refreshGitInfo, state
- src/components/ProjectHeader.tsx - watchProject calls
- src/components/ChangedFilesPanel.tsx - UI rendering
- electron/preload.ts - git.onChanged API exposure

