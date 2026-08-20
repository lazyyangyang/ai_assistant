import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  apiGetChatSessions: vi.fn(),
  apiGetChatSessionMessages: vi.fn(),
}))

const streamMocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  stopChatStream: vi.fn(),
  abortAllChatStreams: vi.fn(),
}))

vi.mock('@/lib/api', () => apiMocks)
vi.mock('@/lib/chatStreamClient', () => ({
  ...streamMocks,
  ChatStreamUnauthorizedError: class ChatStreamUnauthorizedError extends Error {},
}))

import { resetChatStore, useChatStore } from './chatStore'

describe('chatStore', () => {
  beforeEach(() => {
    resetChatStore()
    vi.clearAllMocks()
    apiMocks.apiGetChatSessions.mockResolvedValue([])
  })

  it('owns streamed messages, session id and structured output', async () => {
    const structured = {
      skills: ['TypeScript'],
      responsibilities: ['Build UI'],
      hard_requirements: ['React'],
      summary: 'Frontend role',
    }
    streamMocks.streamChat.mockImplementation(async (options) => {
      options.onSessionId('session-1')
      options.onToken('A')
      options.onToken('B')
      options.onStructuredData(structured)
    })

    useChatStore.getState().initializeAgent('jd', 'Welcome')
    await useChatStore.getState().sendMessage({
      agentType: 'jd',
      content: 'Analyze this role',
    })

    const state = useChatStore.getState()
    expect(state.activeSessionIdByAgent.jd).toBe('session-1')
    expect(state.streamingByAgent.jd).toBe(false)
    expect(state.messagesByAgent.jd.map((message) => message.content)).toEqual([
      'Welcome',
      'Analyze this role',
      'AB',
    ])
    expect(state.structuredByAgent.jd).toEqual(structured)
  })

  it('loads a selected session and restores its JD result', async () => {
    const structured = {
      skills: ['Python'],
      responsibilities: [],
      hard_requirements: [],
      summary: 'Backend role',
    }
    apiMocks.apiGetChatSessions.mockResolvedValue([
      {
        id: 'session-2',
        agent_type: 'jd',
        title: 'Backend role',
        status: 'active',
        jd_content: JSON.stringify(structured),
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      },
    ])
    apiMocks.apiGetChatSessionMessages.mockResolvedValue([
      {
        id: 'message-1',
        session_id: 'session-2',
        role: 'assistant',
        content: 'Saved answer',
        status: 'completed',
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      },
    ])

    await useChatStore.getState().loadSessions('jd')
    await useChatStore.getState().selectSession('jd', 'session-2')

    const state = useChatStore.getState()
    expect(state.activeSessionIdByAgent.jd).toBe('session-2')
    expect(state.messagesByAgent.jd[0]?.content).toBe('Saved answer')
    expect(state.structuredByAgent.jd).toEqual(structured)
  })

  it('delegates cancellation and clears the streaming flag', () => {
    useChatStore.setState((state) => ({
      activeSessionIdByAgent: {
        ...state.activeSessionIdByAgent,
        resume: 'session-3',
      },
      streamingByAgent: { ...state.streamingByAgent, resume: true },
    }))

    useChatStore.getState().stopGeneration('resume')

    expect(streamMocks.stopChatStream).toHaveBeenCalledWith('resume', 'session-3')
    expect(useChatStore.getState().streamingByAgent.resume).toBe(false)
  })

  it('clears user-specific chat state when the auth session resets', () => {
    useChatStore.getState().initializeAgent('interview', 'Welcome')
    useChatStore.setState((state) => ({
      activeSessionIdByAgent: {
        ...state.activeSessionIdByAgent,
        interview: 'session-4',
      },
    }))

    resetChatStore()

    const state = useChatStore.getState()
    expect(state.activeSessionIdByAgent.interview).toBeNull()
    expect(state.messagesByAgent.interview).toEqual([])
    expect(streamMocks.abortAllChatStreams).toHaveBeenCalledTimes(1)
  })
})
