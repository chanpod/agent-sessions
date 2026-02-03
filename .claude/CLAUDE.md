# Agent Sessions - Claude Code Instructions

## ⛔ DESTRUCTIVE GIT COMMANDS - NEVER WITHOUT REVIEW ⛔

**NEVER run `git checkout <file>`, `git restore <file>`, or `git reset` to undo changes without these steps:**

1. **FIRST: Run `git diff <file>`** to see ALL changes in the file
2. **REVIEW the diff** - determine if the changes are ONLY yours or include the user's work
3. **If mixed changes exist:**
   - ❌ DO NOT run `git checkout` - this destroys the user's work!
   - ✅ USE the Edit tool to surgically revert only YOUR specific changes
   - ✅ OR ASK the user first before doing anything destructive
4. **If unsure, ALWAYS ASK** - "I need to revert my changes but I see other modifications. Should I proceed?"

**Why this matters:** `git checkout <file>` permanently destroys ALL uncommitted changes, not just yours. There is no undo. The user's work is gone forever.

## ⛔ Development Server Rules ⛔

**NEVER run the dev server.** Do not run `npm run dev`, `npm start`, `yarn dev`, or any variation that starts a development server.

### Whitelisted Build & Type Check Commands

The following commands ARE allowed:
- `npm run build` / `yarn build` - Production build
- `npm run typecheck` / `yarn typecheck` - TypeScript type checking
- `npx tsc --noEmit` - TypeScript check without emit
- `npx tsc` - TypeScript compilation
- `npm run lint` / `yarn lint` - Linting
- `npm test` / `yarn test` - Running tests

## Windows Development Requirements

### Always Use Git Bash
This project assumes Git Bash is available on Windows. All terminal operations, including:
- Regular terminals
- Agent terminals (Claude, Codex, Gemini)
- Background processes

**MUST** use Git Bash (`bash.exe`), never PowerShell or cmd.exe directly. This ensures:
- Consistent PATH resolution for npm/pip installed tools
- Unix-like command compatibility
- Proper handling of CLI tools like `claude`, `codex`, `gemini`

When spawning processes on Windows, always use:
```typescript
shell = 'bash.exe'
shellArgs = ['-c', command]
```

Do NOT attempt to spawn CLI tools directly on Windows - they won't be found in the system PATH.

## shadcn/ui Components

Use the shadcn CLI to add components into this Vite + Electron repo. The project is already initialized with `components.json`.

Install a component:
```bash
pnpm dlx shadcn@latest add button
```

Notes:
- Components are written to `src/components/ui` with helpers in `src/lib/utils`.
- Styling is driven by `src/index.css` (Tailwind v4 CSS-first + shadcn preset).
- Icon library is Tabler; import from `@tabler/icons-react` if needed.
