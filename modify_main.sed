# Add import after line 16 (generateFileId import)
16 a\
import { registerGitHandlers, cleanupGitWatchers } from './services/git-service.js'

# Delete GitWatcherSet interface and related (lines 434-443)
434,443d

# Add registerGitHandlers call after sshManager.on block (after line 492, which is now 491 after deletions)
482 a\
\
  // Register all git-related IPC handlers\
  registerGitHandlers(mainWindow, sshManager, execInContextAsync)

# Delete all git IPC handlers (lines 978-1678, but adjusted for previous deletions: 968-1668)
968,1668d

# Replace git watcher cleanup (lines 507-519, adjusted: 497-509)
497,509c\
    // Clean up all git watchers\
    cleanupGitWatchers()
