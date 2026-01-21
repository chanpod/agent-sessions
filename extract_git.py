#!/usr/bin/env python3
"""
Script to extract git handlers from electron/main.ts
This performs the following operations:
1. Add import for git-service
2. Add registerGitHandlers call after managers initialization
3. Remove GitWatcherSet interface and gitWatchers Map
4. Remove all git IPC handlers
5. Update cleanup code to call cleanupGitWatchers
"""

def main():
    # Read the file
    with open('electron/main.ts', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    skip_until = None
    i = 0

    while i < len(lines):
        line = lines[i]

        # Step 1: Add import after line 16 (after generateFileId import)
        if i == 16 and 'generateFileId' in line:
            new_lines.append(line)
            new_lines.append("import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'\n")
            i += 1
            continue

        # Step 2: Skip GitWatcherSet interface and gitWatchers Map (lines 377-386, but adjusted for new import)
        # Look for "interface GitWatcherSet"
        if 'interface GitWatcherSet' in line:
            # Skip until we find the line with "const GIT_DEBOUNCE_MS" and one more line
            while i < len(lines):
                i += 1
                if 'const GIT_DEBOUNCE_MS' in lines[i]:
                    i += 1  # Skip the GIT_DEBOUNCE_MS line too
                    break
            continue

        # Step 3: Skip all git IPC handlers
        # Look for ipcMain.handle('git:get-info'
        if "ipcMain.handle('git:get-info'" in line:
            # Skip until we find the closing of git:pull handler
            # Find the end of git:pull handler
            while i < len(lines):
                i += 1
                if i >= len(lines):
                    break
                # Look for the pattern: git:pull handler followed by its closing
                if "ipcMain.handle(" in lines[i] and "'git:pull'" not in lines[i]:
                    # We've reached the next handler (not git-related)
                    # Go back to include this line
                    break
                if "// File system IPC handlers" in lines[i]:
                    # We've reached the file system handlers section
                    break
            continue

        # Step 4: Add registerGitHandlers call after sshManager.on('status-change') block
        # Look for the closing of sshManager.on block
        if i > 0 and '  })' in line and 'sshManager.on' in ''.join(lines[max(0, i-20):i]):
            # Check if this is the status-change listener closing
            for j in range(max(0, i-20), i):
                if "sshManager.on('status-change'" in lines[j]:
                    new_lines.append(line)
                    new_lines.append('\n')
                    new_lines.append('  // Register all git-related IPC handlers\n')
                    new_lines.append('  registerGitHandlers(mainWindow, sshManager, execInContextAsync)\n')
                    i += 1
                    continue

        # Step 5: Update cleanup code
        if '// Clean up all git watchers' in line:
            # Replace the git watcher cleanup block with cleanupGitWatchers() call
            new_lines.append('    // Clean up all git watchers\n')
            new_lines.append('    cleanupGitWatchers()\n')
            # Skip until gitWatchers.clear()
            while i < len(lines):
                i += 1
                if 'gitWatchers.clear()' in lines[i]:
                    i += 1
                    break
            continue

        # Default: keep the line
        new_lines.append(line)
        i += 1

    # Write the modified file
    with open('electron/main.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print("Git handlers extraction complete!")
    print(f"Original lines: {len(lines)}")
    print(f"New lines: {len(new_lines)}")
    print(f"Lines removed: {len(lines) - len(new_lines)}")

if __name__ == '__main__':
    main()
