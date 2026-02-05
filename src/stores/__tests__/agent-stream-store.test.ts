import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the electron-storage module so zustand's persist middleware
// uses a simple in-memory storage instead of hitting window.electron.store.
const memoryStore = new Map<string, string>()
vi.mock('../../lib/electron-storage', () => ({
  electronStorage: {
    getItem: (name: string) => memoryStore.get(name) ?? null,
    setItem: (name: string, value: string) => { memoryStore.set(name, value) },
    removeItem: (name: string) => { memoryStore.delete(name) },
  },
}))

// Mock terminal-store and permission-store (imported by agent-stream-store but
// only used in IPC subscription code paths we don't exercise here).
vi.mock('../terminal-store', () => ({
  useTerminalStore: {
    getState: () => ({
      updateConfigSessionId: vi.fn(),
    }),
  },
}))

vi.mock('../permission-store', () => ({
  usePermissionStore: {
    getState: () => ({
      addRequest: vi.fn(),
    }),
  },
}))

import { useAgentStreamStore, type PersistedSessionData } from '../agent-stream-store'
import type { AgentMessage, ContentBlock, TerminalAgentState } from '../../types/stream-json'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal completed AgentMessage for testing. */
function makeMessage(id: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    model: 'claude-test',
    blocks: [{ type: 'text', content: `content for ${id}`, isComplete: true } as ContentBlock],
    status: 'completed',
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
    ...overrides,
  }
}

/** Create a terminal agent state with N completed messages. */
function makeTerminalState(messageCount: number): TerminalAgentState {
  const messages: AgentMessage[] = []
  for (let i = 0; i < messageCount; i++) {
    messages.push(makeMessage(`msg_${i}`))
  }
  return {
    currentMessage: null,
    messages,
    isActive: false,
    isWaitingForResponse: false,
  }
}

/** Reset the store to a clean slate before each test. */
function resetStore() {
  useAgentStreamStore.setState({
    terminals: new Map(),
    conversations: new Map(),
    sessions: {},
    terminalToSession: new Map(),
    sessionToInitialProcess: new Map(),
    hasRehydrated: true,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-stream-store persistence', () => {
  beforeEach(() => {
    resetStore()
  })

  // -------------------------------------------------------------------------
  // (a) No truncation — all messages persisted
  // -------------------------------------------------------------------------
  it('persists all completed messages without truncation', () => {
    const terminalId = 'term-1'
    const sessionId = 'session-abc'
    const messageCount = 120 // well above any old .slice(50) limit

    // Set up terminal with many messages and link to session
    const terminals = new Map<string, TerminalAgentState>()
    terminals.set(terminalId, makeTerminalState(messageCount))

    const terminalToSession = new Map<string, string>()
    terminalToSession.set(terminalId, sessionId)

    const sessionToInitialProcess = new Map<string, string>()
    sessionToInitialProcess.set(sessionId, terminalId)

    useAgentStreamStore.setState({
      terminals,
      terminalToSession,
      sessionToInitialProcess,
    })

    // Act
    useAgentStreamStore.getState().persistSession(terminalId, 'claude', '/home/test')

    // Assert
    const persisted = useAgentStreamStore.getState().sessions[sessionId]
    expect(persisted).toBeDefined()
    expect(persisted!.messages).toHaveLength(messageCount)
    expect(persisted!.sessionId).toBe(sessionId)
    expect(persisted!.agentType).toBe('claude')
    expect(persisted!.cwd).toBe('/home/test')
  })

  // -------------------------------------------------------------------------
  // (b) User messages are included in persisted data
  // -------------------------------------------------------------------------
  it('includes user messages from conversations in persisted session', () => {
    const terminalId = 'term-2'
    const sessionId = 'session-def'

    // Build terminal with one completed agent message
    const terminals = new Map<string, TerminalAgentState>()
    terminals.set(terminalId, makeTerminalState(2))

    const terminalToSession = new Map<string, string>()
    terminalToSession.set(terminalId, sessionId)

    const sessionToInitialProcess = new Map<string, string>()
    sessionToInitialProcess.set(sessionId, terminalId)

    // Conversation state with user messages
    const userMessages = [
      { id: 'u1', content: 'Hello agent', timestamp: Date.now() - 2000, agentType: 'claude' },
      { id: 'u2', content: 'Follow-up question', timestamp: Date.now() - 1000, agentType: 'claude' },
    ]
    const conversations = new Map()
    conversations.set(terminalId, {
      processIds: [terminalId],
      userMessages,
    })

    useAgentStreamStore.setState({
      terminals,
      terminalToSession,
      sessionToInitialProcess,
      conversations,
    })

    // Act
    useAgentStreamStore.getState().persistSession(terminalId, 'claude', '/proj')

    // Assert
    const persisted = useAgentStreamStore.getState().sessions[sessionId]
    expect(persisted).toBeDefined()
    expect(persisted!.userMessages).toHaveLength(2)
    expect(persisted!.userMessages[0]!.content).toBe('Hello agent')
    expect(persisted!.userMessages[1]!.content).toBe('Follow-up question')
  })

  // -------------------------------------------------------------------------
  // (c) Backward compatibility — missing userMessages defaults gracefully
  // -------------------------------------------------------------------------
  it('handles restoring a session with no userMessages field (backward compat)', () => {
    const terminalId = 'term-restored'
    const sessionId = 'session-old'

    // Simulate an old persisted session that has no userMessages field
    const oldSession = {
      sessionId,
      agentType: 'claude',
      messages: [makeMessage('old-msg-1')],
      // userMessages intentionally omitted
      lastActiveAt: Date.now(),
      cwd: '/old/path',
    } as unknown as PersistedSessionData

    useAgentStreamStore.setState({
      sessions: { [sessionId]: oldSession },
    })

    // Act — should not throw
    useAgentStreamStore.getState().restoreSessionToTerminal(terminalId, sessionId)

    // Assert — terminal state is hydrated with the single message
    const terminalState = useAgentStreamStore.getState().terminals.get(terminalId)
    expect(terminalState).toBeDefined()
    expect(terminalState!.messages).toHaveLength(1)
    expect(terminalState!.messages[0]!.id).toBe('old-msg-1')

    // Conversations Map should either have no entry for this terminal or
    // an entry with empty userMessages (since there were none to restore).
    const sessionToInitial = useAgentStreamStore.getState().sessionToInitialProcess.get(sessionId)
    const conversation = useAgentStreamStore.getState().conversations.get(sessionToInitial ?? terminalId)
    // If no user messages existed, the conversation entry is not created
    // (length === 0 path in restoreSessionToTerminal), which is correct.
    if (conversation) {
      expect(conversation.userMessages).toEqual([])
    }
  })

  // -------------------------------------------------------------------------
  // (d) restoreSessionToTerminal restores user messages into conversations
  // -------------------------------------------------------------------------
  it('restores user messages into the conversations Map on session restore', () => {
    const terminalId = 'term-restore-um'
    const sessionId = 'session-with-um'

    const userMessages = [
      { id: 'u10', content: 'First message', timestamp: 1000, agentType: 'claude' },
      { id: 'u11', content: 'Second message', timestamp: 2000, agentType: 'claude' },
    ]

    const sessionData: PersistedSessionData = {
      sessionId,
      agentType: 'claude',
      messages: [makeMessage('msg-a'), makeMessage('msg-b')],
      userMessages,
      lastActiveAt: Date.now(),
      cwd: '/some/dir',
    }

    useAgentStreamStore.setState({
      sessions: { [sessionId]: sessionData },
    })

    // Act
    useAgentStreamStore.getState().restoreSessionToTerminal(terminalId, sessionId)

    // Assert — conversations should contain the user messages
    const initialProcessId = useAgentStreamStore.getState().sessionToInitialProcess.get(sessionId)
    expect(initialProcessId).toBe(terminalId)

    const conversation = useAgentStreamStore.getState().conversations.get(initialProcessId!)
    expect(conversation).toBeDefined()
    expect(conversation!.userMessages).toHaveLength(2)
    expect(conversation!.userMessages[0]!.id).toBe('u10')
    expect(conversation!.userMessages[1]!.id).toBe('u11')
  })

  // -------------------------------------------------------------------------
  // (e) sessionToInitialProcess — first process wins
  // -------------------------------------------------------------------------
  it('keeps the first terminal for sessionToInitialProcess (first-process-wins)', () => {
    const sessionId = 'session-xyz'
    const firstTerminal = 'term-first'
    const secondTerminal = 'term-second'

    // Act — set session for first terminal, then second
    useAgentStreamStore.getState().setTerminalSession(firstTerminal, sessionId)
    useAgentStreamStore.getState().setTerminalSession(secondTerminal, sessionId)

    // Assert — sessionToInitialProcess should still point to the first terminal
    const initialProcess = useAgentStreamStore.getState().sessionToInitialProcess.get(sessionId)
    expect(initialProcess).toBe(firstTerminal)

    // Both terminals should map to the same session
    expect(useAgentStreamStore.getState().terminalToSession.get(firstTerminal)).toBe(sessionId)
    expect(useAgentStreamStore.getState().terminalToSession.get(secondTerminal)).toBe(sessionId)
  })
})
