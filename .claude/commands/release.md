---
description: Create a new version release with git tag
---

You are helping the user create a new release of their Electron app.

PRE-APPROVED COMMANDS:
The following git commands are pre-approved and do not require user permission:
- git status
- git log (all variants including --oneline, --since, etc.)
- git tag (all variants including --list, --sort, etc.)
- git diff (all variants)
- git show (all variants)

Follow these steps:

1. Check git status to see if there are uncommitted changes

2. Read the current version from package.json

3. Get the latest git tag using: `git tag --list --sort=-version:refname`

4. Generate a release summary by getting all commits since the last tag:
   - Use: `git log <last-tag>..HEAD --oneline` to get commit messages
   - Summarize the changes in a concise, user-friendly format
   - Group by type if applicable (Features, Bug Fixes, Improvements, etc.)

5. Ask the user what type of version bump they want:
   - patch (0.2.2 -> 0.2.3) - for bug fixes
   - minor (0.2.2 -> 0.3.0) - for new features
   - major (0.2.2 -> 1.0.0) - for breaking changes
   Show them the auto-generated summary and ask if they want to modify it

6. Calculate the new version based on their choice

7. If there are uncommitted changes, commit them first with a descriptive message

8. Update the version in package.json

9. Create a git commit with:
   - Message: "Bump version to X.X.X"
   - Body containing the release summary
   - Include the standard Claude Code co-author footer

10. Push the commit to the remote repository

11. Create and push a git tag (vX.X.X format)

12. Inform the user that:
    - The GitHub Actions workflow will now build and publish the release
    - They can monitor progress at: https://github.com/chanpod/agent-sessions/actions
    - Once complete, the release will be available at: https://github.com/chanpod/agent-sessions/releases

13. Remind them that electron-updater will now work because the release assets will be uploaded with the latest.yml files

IMPORTANT:
- Always use semantic versioning (MAJOR.MINOR.PATCH)
- Use the standard commit message format with Claude Code footer
- Auto-generate changelog from commits since last tag
- Commit any uncommitted changes before bumping version
