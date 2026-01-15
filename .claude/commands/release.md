---
description: Create a new version release with git tag
---

You are helping the user create a new release of their Electron app.

Follow these steps:

1. Ask the user what type of version bump they want:
   - patch (0.2.2 -> 0.2.3) - for bug fixes
   - minor (0.2.2 -> 0.3.0) - for new features
   - major (0.2.2 -> 1.0.0) - for breaking changes
   - Or let them specify a custom version number

2. Read the current version from package.json

3. Calculate the new version based on their choice

4. Ask the user for a release summary/changelog (what changed in this version)

5. Update the version in package.json

6. Create a git commit with:
   - Message: "Bump version to X.X.X"
   - Body containing the release summary
   - Include the standard Claude Code co-author footer

7. Push the commit to the remote repository

8. Create and push a git tag (vX.X.X format)

9. Inform the user that:
   - The GitHub Actions workflow will now build and publish the release
   - They can monitor progress at: https://github.com/chanpod/agent-sessions/actions
   - Once complete, the release will be available at: https://github.com/chanpod/agent-sessions/releases

10. Remind them that electron-updater will now work because the release assets will be uploaded with the latest.yml files

IMPORTANT:
- Always use semantic versioning (MAJOR.MINOR.PATCH)
- Ensure git status is clean before starting (or ask user to commit/stash changes)
- Use the standard commit message format with Claude Code footer
