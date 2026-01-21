#!/usr/bin/env python3
"""
Modify electron/main.ts to use git-service
"""

def main():
    with open('electron/main.ts', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    i = 0

    while i < len(lines):
        line = lines[i]
        line_num = i + 1  # 1-indexed

        # Step 1: Add import after line 16 (generateFileId import)
        if line_num == 17 and lines[i-1].strip().startswith("import { generateFileId"):
            new_lines.append("import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'\n")
            new_lines.append(line)
            i += 1
            continue

        # Step 2: Skip GitWatcherSet interface and gitWatchers (lines 434-443)
        if line_num == 434 and 'interface GitWatcherSet' in line:
            # Skip lines 434-443 (10 lines total)
            i += 10
            continue

        # Step 3: Add registerGitHandlers call after sshManager.on block (after line 492)
        if line_num == 492 and '  })' in line and i > 0:
            # Check if previous lines contain sshManager.on('status-change'
            context = ''.join(lines[max(0, i-10):i])
            if "sshManager.on('status-change'" in context:
                new_lines.append(line)
                new_lines.append('\n')
                new_lines.append('  // Register all git-related IPC handlers\n')
                new_lines.append('  registerGitHandlers(mainWindow, sshManager, execInContextAsync)\n')
                i += 1
                continue

        # Step 4: Skip git IPC handlers (lines 978-1678)
        if line_num == 978 and "ipcMain.handle('git:get-info'" in line:
            # Skip until line 1678 (inclusive)
            # 1678 - 978 + 1 = 701 lines
            i += 701
            continue

        # Step 5: Replace git watcher cleanup (lines 507-519)
        if line_num == 507 and '// Clean up all git watchers' in line:
            new_lines.append('    // Clean up all git watchers\n')
            new_lines.append('    cleanupGitWatchers()\n')
            # Skip lines 507-519 (13 lines total)
            i += 13
            continue

        # Default: keep line
        new_lines.append(line)
        i += 1

    # Write back
    with open('electron/main.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print(f"Modified! Original: {len(lines)} lines, New: {len(new_lines)} lines")
    print(f"Removed: {len(lines) - len(new_lines)} lines")

if __name__ == '__main__':
    main()
