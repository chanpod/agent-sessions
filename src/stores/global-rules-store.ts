import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export interface PresetRule {
  id: string
  name: string
  description: string
  ruleContent: string
  category: 'safety' | 'quality' | 'workflow'
}

export interface GlobalRule extends PresetRule {
  enabled: boolean
  isCustom: boolean
}

interface GlobalRulesState {
  rules: GlobalRule[]
  initialized: boolean
}

interface GlobalRulesActions {
  loadRules: () => Promise<void>
  saveRules: () => Promise<void>
  toggleRule: (ruleId: string) => void
  addCustomRule: (
    name: string,
    description: string,
    content: string,
    category: 'safety' | 'quality' | 'workflow'
  ) => void
  updateCustomRule: (
    ruleId: string,
    updates: Partial<Pick<GlobalRule, 'name' | 'description' | 'ruleContent' | 'category'>>
  ) => void
  removeCustomRule: (ruleId: string) => void
  getEnabledRules: () => GlobalRule[]
  getEnabledRulesText: () => string
}

type GlobalRulesStore = GlobalRulesState & GlobalRulesActions

interface StoredData {
  rules: GlobalRule[]
}

// ============================================================================
// Constants
// ============================================================================

const STORE_KEY = 'global-lint-rules'

const PRESET_RULES: PresetRule[] = [
  // SAFETY category
  {
    id: 'no-dev-server',
    name: "Don't Run Dev Server",
    description: 'Prevents AI from starting development servers that could block the terminal.',
    ruleContent:
      'Never run npm run dev, npm start, yarn dev, or any development server commands.',
    category: 'safety',
  },
  {
    id: 'ask-before-destructive-git',
    name: 'Ask Before Destructive Git',
    description: 'Requires confirmation before potentially destructive git operations.',
    ruleContent:
      'Always ask for confirmation before running destructive git commands like reset --hard, checkout ., clean -f, or force push.',
    category: 'safety',
  },
  {
    id: 'read-before-modifying',
    name: 'Read Before Modifying',
    description: 'Ensures AI understands file contents before making changes.',
    ruleContent: "Always read a file's current content before making modifications to it.",
    category: 'safety',
  },

  // QUALITY category
  {
    id: 'run-typecheck',
    name: 'Run TypeScript Check',
    description: 'Verifies type safety after TypeScript changes.',
    ruleContent:
      'Run npx tsc --noEmit or npm run typecheck after making TypeScript changes to verify type safety.',
    category: 'quality',
  },
  {
    id: 'prefer-editing',
    name: 'Prefer Editing Over Creating',
    description: 'Reduces file proliferation by preferring edits to existing files.',
    ruleContent:
      'Prefer editing existing files over creating new ones. Only create new files when absolutely necessary.',
    category: 'quality',
  },
  {
    id: 'no-unnecessary-comments',
    name: 'No Unnecessary Comments',
    description: 'Prevents AI from adding unwanted documentation to unchanged code.',
    ruleContent:
      "Don't add comments, docstrings, or type annotations to code you didn't change unless explicitly requested.",
    category: 'quality',
  },

  // WORKFLOW category
  {
    id: 'minimal-changes',
    name: 'Minimal Changes Only',
    description: 'Keeps AI focused on the specific request without over-engineering.',
    ruleContent:
      'Only make changes that are directly requested. Avoid over-engineering, adding features, or making improvements beyond what was asked.',
    category: 'workflow',
  },
  {
    id: 'explain-before-acting',
    name: 'Explain Before Acting',
    description: 'Allows user to course-correct before changes are made.',
    ruleContent:
      'Briefly explain your approach before making changes, so the user can course-correct if needed.',
    category: 'workflow',
  },
]

// ============================================================================
// Utilities
// ============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

function createDefaultRules(): GlobalRule[] {
  return PRESET_RULES.map((preset) => ({
    ...preset,
    enabled: false,
    isCustom: false,
  }))
}

function mergeWithPresets(storedRules: GlobalRule[]): GlobalRule[] {
  // Start with fresh preset rules (all disabled)
  const merged: GlobalRule[] = createDefaultRules()

  // Create a map of stored rules by ID for quick lookup
  const storedMap = new Map(storedRules.map((r) => [r.id, r]))

  // Update preset rules with stored enabled state
  for (const rule of merged) {
    const stored = storedMap.get(rule.id)
    if (stored && !stored.isCustom) {
      rule.enabled = stored.enabled
    }
  }

  // Add any custom rules from storage
  const customRules = storedRules.filter((r) => r.isCustom)
  merged.push(...customRules)

  return merged
}

// ============================================================================
// Store
// ============================================================================

export const useGlobalRulesStore = create<GlobalRulesStore>()((set, get) => ({
  // Initial state
  rules: [],
  initialized: false,

  // Actions
  loadRules: async () => {
    try {
      const stored = (await window.electron.store.get(STORE_KEY)) as StoredData | null

      if (stored && stored.rules && Array.isArray(stored.rules)) {
        // Merge stored rules with presets to handle new presets or removed ones
        const mergedRules = mergeWithPresets(stored.rules)
        set({ rules: mergedRules, initialized: true })
      } else {
        // No stored data - use defaults
        set({ rules: createDefaultRules(), initialized: true })
      }
    } catch (error) {
      console.error('[GlobalRulesStore] Error loading rules:', error)
      set({ rules: createDefaultRules(), initialized: true })
    }
  },

  saveRules: async () => {
    const state = get()
    const data: StoredData = { rules: state.rules }

    try {
      await window.electron.store.set(STORE_KEY, data)
    } catch (error) {
      console.error('[GlobalRulesStore] Error saving rules:', error)
    }
  },

  toggleRule: (ruleId: string) => {
    set((state) => ({
      rules: state.rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    }))
    get().saveRules()
  },

  addCustomRule: (
    name: string,
    description: string,
    content: string,
    category: 'safety' | 'quality' | 'workflow'
  ) => {
    const newRule: GlobalRule = {
      id: generateId(),
      name,
      description,
      ruleContent: content,
      category,
      enabled: true, // New custom rules are enabled by default
      isCustom: true,
    }

    set((state) => ({
      rules: [...state.rules, newRule],
    }))
    get().saveRules()
  },

  updateCustomRule: (
    ruleId: string,
    updates: Partial<Pick<GlobalRule, 'name' | 'description' | 'ruleContent' | 'category'>>
  ) => {
    set((state) => ({
      rules: state.rules.map((r) => {
        if (r.id === ruleId && r.isCustom) {
          return { ...r, ...updates }
        }
        return r
      }),
    }))
    get().saveRules()
  },

  removeCustomRule: (ruleId: string) => {
    set((state) => ({
      rules: state.rules.filter((r) => !(r.id === ruleId && r.isCustom)),
    }))
    get().saveRules()
  },

  getEnabledRules: () => {
    return get().rules.filter((r) => r.enabled)
  },

  getEnabledRulesText: () => {
    const enabledRules = get().getEnabledRules()

    if (enabledRules.length === 0) {
      return ''
    }

    const lines: string[] = ['## Global Rules', '']

    for (const rule of enabledRules) {
      lines.push(`### ${rule.name}`)
      lines.push(rule.ruleContent)
      lines.push('')
    }

    return lines.join('\n').trim()
  },
}))
