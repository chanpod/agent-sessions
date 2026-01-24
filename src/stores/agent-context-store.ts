import { create } from 'zustand'

export interface AgentContext {
  id: string
  projectId: string
  name: string                    // e.g., "Default Context", "Code Review Context"
  content: string                 // The actual context/prompt text to inject
  agentId?: string                // Optional: lock to specific agent (claude/gemini/codex)
  createdAt: number
  updatedAt: number
}

interface AgentContextState {
  contexts: AgentContext[]
  activeContextId: string | null
  currentProjectId: string | null
  isLoaded: boolean
}

interface AgentContextActions {
  // Load/save operations
  loadContexts: (projectId: string) => Promise<void>
  saveContexts: () => Promise<void>

  // CRUD operations
  addContext: (context: Omit<AgentContext, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>
  updateContext: (id: string, updates: Partial<Pick<AgentContext, 'name' | 'content' | 'agentId'>>) => Promise<void>
  removeContext: (id: string) => Promise<void>
  setActiveContext: (contextId: string | null) => Promise<void>
  duplicateContext: (id: string) => Promise<string | null>

  // Getters (synchronous, work on loaded state)
  getContexts: () => AgentContext[]
  getActiveContext: () => AgentContext | null
}

type AgentContextStore = AgentContextState & AgentContextActions

function generateId(): string {
  return crypto.randomUUID()
}

function getStoreKey(projectId: string): string {
  return `agent-contexts-${projectId}`
}

interface StoredData {
  contexts: AgentContext[]
  activeContextId: string | null
}

export const useAgentContextStore = create<AgentContextStore>()((set, get) => ({
  contexts: [],
  activeContextId: null,
  currentProjectId: null,
  isLoaded: false,

  loadContexts: async (projectId: string) => {
    const key = getStoreKey(projectId)
    console.log('[AgentContextStore] Loading contexts for project:', projectId)

    try {
      const stored = await window.electron.store.get(key) as StoredData | null

      if (stored && stored.contexts) {
        // Validate activeContextId references
        const contextIds = new Set(stored.contexts.map((c) => c.id))
        const validActiveId = stored.activeContextId && contextIds.has(stored.activeContextId)
          ? stored.activeContextId
          : null

        if (stored.activeContextId && !validActiveId) {
          console.warn('[AgentContextStore] Removed invalid activeContextId reference:', stored.activeContextId)
        }

        set({
          contexts: stored.contexts,
          activeContextId: validActiveId,
          currentProjectId: projectId,
          isLoaded: true,
        })
        console.log('[AgentContextStore] Loaded', stored.contexts.length, 'contexts')
      } else {
        // No stored data, start fresh
        set({
          contexts: [],
          activeContextId: null,
          currentProjectId: projectId,
          isLoaded: true,
        })
        console.log('[AgentContextStore] No stored contexts, starting fresh')
      }
    } catch (error) {
      console.error('[AgentContextStore] Error loading contexts:', error)
      // Start fresh on error
      set({
        contexts: [],
        activeContextId: null,
        currentProjectId: projectId,
        isLoaded: true,
      })
    }
  },

  saveContexts: async () => {
    const state = get()
    if (!state.currentProjectId) {
      console.warn('[AgentContextStore] Cannot save: no project loaded')
      return
    }

    const key = getStoreKey(state.currentProjectId)
    const data: StoredData = {
      contexts: state.contexts,
      activeContextId: state.activeContextId,
    }

    try {
      await window.electron.store.set(key, data)
      console.log('[AgentContextStore] Saved', state.contexts.length, 'contexts')
    } catch (error) {
      console.error('[AgentContextStore] Error saving contexts:', error)
    }
  },

  addContext: async (context) => {
    const id = generateId()
    const now = Date.now()
    const newContext: AgentContext = {
      ...context,
      id,
      createdAt: now,
      updatedAt: now,
    }

    set((state) => ({
      contexts: [...state.contexts, newContext],
    }))

    await get().saveContexts()
    return id
  },

  updateContext: async (id, updates) => {
    set((state) => ({
      contexts: state.contexts.map((c) =>
        c.id === id
          ? { ...c, ...updates, updatedAt: Date.now() }
          : c
      ),
    }))

    await get().saveContexts()
  },

  removeContext: async (id) => {
    set((state) => {
      // Also clean up activeContextId if it points to this context
      const newActiveContextId = state.activeContextId === id ? null : state.activeContextId
      return {
        contexts: state.contexts.filter((c) => c.id !== id),
        activeContextId: newActiveContextId,
      }
    })

    await get().saveContexts()
  },

  setActiveContext: async (contextId) => {
    set({ activeContextId: contextId })
    await get().saveContexts()
  },

  duplicateContext: async (id) => {
    const state = get()
    const original = state.contexts.find((c) => c.id === id)
    if (!original) return null

    const newId = generateId()
    const now = Date.now()
    const duplicated: AgentContext = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    }

    set((state) => ({
      contexts: [...state.contexts, duplicated],
    }))

    await get().saveContexts()
    return newId
  },

  getContexts: () => get().contexts,

  getActiveContext: () => {
    const state = get()
    if (!state.activeContextId) return null
    return state.contexts.find((c) => c.id === state.activeContextId) ?? null
  },
}))
