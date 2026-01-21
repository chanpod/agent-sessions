#!/usr/bin/env python3
"""
Modify electron/main.ts to use git-service
Works with the current state of the file (2283 lines, with WSL utils inline)
"""

def main():
    with open('electron/main.ts', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    skip_until_line = None

    for i, line in enumerate(lines):
        line_num = i + 1  # 1-indexed

        # If we're skipping lines, check if we should stop
        if skip_until_line is not None:
            if line_num > skip_until_line:
                skip_until_line = None
            else:
                continue  # Skip this line

        # Step 1: Add import after line 16 (generateFileId import)
        if line_num == 16 and 'generateFileId' in line:
            new_lines.append(line)
            new_lines.append("import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'\n")
            continue

        # Step 2: Skip GitWatcherSet interface and gitWatchers (lines 439-448)
        # Line 439: interface GitWatcherSet {
        # Line 447: const gitWatchers = ...
        # Line 448: const GIT_DEBOUNCE_MS = ...
        if line_num == 439 and 'interface GitWatcherSet' in line:
            skip_until_line = 448  # Skip through GIT_DEBOUNCE_MS
            continue

        # Step 3: Add registerGitHandlers call after sshManager.on block
        # The sshManager.on('status-change') block ends around line 497
        # We need to find the closing }) of that block
        if line_num == 497 and '  })' in line:
            # Check if this is the status-change listener
            context = ''.join(lines[max(0, i-10):i])
            if "sshManager.on('status-change'" in context:
                new_lines.append(line)
                new_lines.append('\n')
                new_lines.append('  // Register all git-related IPC handlers\n')
                new_lines.append('  registerGitHandlers(mainWindow, sshManager, execInContextAsync)\n')
                continue

        # Step 4: Skip git IPC handlers (lines 947-1689)
        # Line 947: ipcMain.handle('git:get-info'
        # Line 1689: ) <-- closing of git:pull handler
        if line_num == 947 and "ipcMain.handle('git:get-info'" in line:
            skip_until_line = 1689  # Skip through the closing of git:pull
            continue

        # Step 5: Replace git watcher cleanup
        # Find "// Clean up all git watchers" and replace the whole block
        if '// Clean up all git watchers' in line and line_num > 500:
            new_lines.append('    // Clean up all git watchers\n')
            new_lines.append('    cleanupGitWatchers()\n')
            # Skip until we find gitWatchers.clear()
            for j in range(i+1, len(lines)):
                if 'gitWatchers.clear()' in lines[j]:
                    skip_until_line = j + 1
                    break
            continue

        # Default: keep line
        new_lines.append(line)

    # Write back
    with open('electron/main.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print(f"Modified! Original: {len(lines)} lines, New: {len(new_lines)} lines")
    print(f"Removed: {len(lines) - len(new_lines)} lines")

if __name__ == '__main__':
    main()
