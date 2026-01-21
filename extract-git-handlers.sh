#!/bin/bash

# Script to extract git handlers from main.ts and update it to use git-service

# Step 1: Add import for git-service
sed -i '16a import { registerGitHandlers, cleanupGitWatchers } from '"'"'./services/git-service.js'"'"'' electron/main.ts

# Step 2: Find the line where sshManager status-change listener is set up and add registerGitHandlers call after it
# Look for the closing of the sshManager.on('status-change') block and add after it
sed -i '/sshManager.on.*status-change/,/^  })/{
  /^  })/ a\
\
  // Register all git-related IPC handlers\
  registerGitHandlers(mainWindow, sshManager, execInContextAsync)
}' electron/main.ts

# Step 3: Remove GitWatcherSet interface and gitWatchers Map (lines 377-386)
sed -i '377,386d' electron/main.ts

# Step 4: Remove all git IPC handlers (lines 1220-1961 in original, but will be different after deletions)
# We'll delete from 'git:get-info' to the end of 'git:pull' handler
sed -i '/ipcMain.handle.*git:get-info/,/ipcMain.handle.*git:pull/{
  /ipcMain.handle.*git:pull/,/^})/{
    /^})/d
  }
  d
}' electron/main.ts

# Step 5: Update cleanup code to call cleanupGitWatchers instead of inline git watcher cleanup
sed -i '/Clean up all git watchers/,/gitWatchers.clear()/{
  s/.*/    cleanupGitWatchers()/
  t
  d
}' electron/main.ts

echo "Git handlers extraction complete!"
