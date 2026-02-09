import { create } from 'zustand'

/**
 * Lightweight store for draft input text.
 *
 * Separated from agent-stream-store so that per-keystroke updates don't
 * trigger selector evaluation on the much larger store (which has 12+
 * selectors in AgentWorkspace alone). This eliminates the main source of
 * input lag: every keystroke was causing Zustand to re-run allProcessStates,
 * anyActive, conversation derivation, etc.
 */
interface DraftInputStore {
  draftInputs: Map<string, string>
  setDraftInput(sessionKey: string, text: string): void
  getDraftInput(sessionKey: string): string
  clearDraftInput(sessionKey: string): void
  clearAll(): void
}

export const useDraftInputStore = create<DraftInputStore>((set, get) => ({
  draftInputs: new Map(),

  setDraftInput: (sessionKey: string, text: string) => {
    set((state) => {
      const draftInputs = new Map(state.draftInputs)
      if (text) {
        draftInputs.set(sessionKey, text)
      } else {
        draftInputs.delete(sessionKey)
      }
      return { draftInputs }
    })
  },

  getDraftInput: (sessionKey: string) => {
    return get().draftInputs.get(sessionKey) ?? ''
  },

  clearDraftInput: (sessionKey: string) => {
    set((state) => {
      const draftInputs = new Map(state.draftInputs)
      draftInputs.delete(sessionKey)
      return { draftInputs }
    })
  },

  clearAll: () => {
    set({ draftInputs: new Map() })
  },
}))
