#!/usr/bin/env python3
"""
Modify electron/main.ts to use git-service
Works with the original git-restored file (2967 lines)
"""

def main():
    with open('electron/main.ts', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    print(f"Starting with {len(lines)} lines")

    new_lines = []
    i = 0

    while i < len(lines):
        line = lines[i]
        line_num = i + 1  # 1-indexed

        # Step 1: Add import after line 16 (generateFileId import)
        if line_num == 16 and 'generateFileId' in line:
            new_lines.append(line)
            new_lines.append("import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'\n")
            i += 1
            continue

        # Step 2: Skip GitWatcherSet interface and gitWatchers (lines 434-443)
        if line_num == 434 and 'interface GitWatcherSet' in line:
            print(f"Skipping GitWatcherSet at line {line_num}")
            # Skip through line 443 (const GIT_DEBOUNCE_MS)
            i += 10  # Skip 10 lines (434-443)
            continue

        # Step 3: Add registerGitHandlers call after sshManager.on block (around line 545)
        # Find the line that closes the sshManager.on('status-change') block
        if '  })' in line and line_num > 540 and line_num < 550:
            # Check if previous lines contain sshManager.on('status-change'
            context = ''.join(lines[max(0, i-10):i])
            if "sshManager.on('status-change'" in context:
                print(f"Adding registerGitHandlers call after line {line_num}")
                new_lines.append(line)
                new_lines.append('\n')
                new_lines.append('  // Register all git-related IPC handlers\n')
                new_lines.append('  registerGitHandlers(mainWindow, sshManager, execInContextAsync)\n')
                i += 1
                continue

        # Step 4: Skip git IPC handlers (lines 1277-2018)
        if line_num == 1277 and "ipcMain.handle('git:get-info'" in line:
            print(f"Skipping git handlers from line {line_num}")
            # Skip to line 2019 (after the closing ) of git:pull)
            # 2019 - 1277 = 742 lines to skip
            i += 742
            continue

        # Step 5: Replace git watcher cleanup
        if '// Clean up all git watchers' in line and line_num > 500 and line_num < 600:
            print(f"Replacing git watcher cleanup at line {line_num}")
            new_lines.append('    // Clean up all git watchers\n')
            new_lines.append('    cleanupGitWatchers()\n')
            # Skip the cleanup loop - find gitWatchers.clear()
            while i < len(lines):
                i += 1
                if 'gitWatchers.clear()' in lines[i]:
                    i += 1  # Skip the clear() line too
                    break
            continue

        # Default: keep line
        new_lines.append(line)
        i += 1

    # Write back
    with open('electron/main.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print(f"\nModified! Original: {len(lines)} lines, New: {len(new_lines)} lines")
    print(f"Removed: {len(lines) - len(new_lines)} lines")
    print(f"Expected to remove ~750 lines (git handlers + GitWatcherSet + cleanup)")

if __name__ == '__main__':
    main()
