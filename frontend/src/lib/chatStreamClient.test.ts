import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  apiStopChatSession: vi.fn(),
}))

vi.mock('@/lib/api', () => apiMocks)

import { stopChatStream, streamChat } from './chatStreamClient'

describe('chatStreamClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses token and structured SSE events', async () => {
    const structured = {
      skills: ['TypeScript'],
      responsibilities: ['Build UI'],
      hard_requirements: ['React'],
      summary: 'Frontend role',
    }
    const body = [
      'event: token',
      'data: {"content":"A"}',
      '',
      'event: token',
      'data: {"content":"B"}',
      '',
      'event: structured',
      `data: ${JSON.stringify(structured)}`,
      '',
      'event: done',
      'data: [DONE]',
      '',
    ].join('\n')
    apiMocks.authenticatedFetch.mockResolvedValue(
      new Response(body, { headers: { 'X-Session-Id': 'session-1' } }),
    )
    const onSessionId = vi.fn()
    const onToken = vi.fn()
    const onStructuredData = vi.fn()

    await streamChat({
      agentType: 'jd',
      messages: [{ role: 'user', content: 'analyze' }],
      onSessionId,
      onToken,
      onStructuredData,
    })

    expect(onSessionId).toHaveBeenCalledWith('session-1')
    expect(onToken.mock.calls.flat()).toEqual(['A', 'B'])
    expect(onStructuredData).toHaveBeenCalledWith(structured)
  })

  it('notifies the backend when an existing session is stopped', () => {
    apiMocks.apiStopChatSession.mockResolvedValue(undefined)

    stopChatStream('resume', 'session-2')

    expect(apiMocks.apiStopChatSession).toHaveBeenCalledWith('session-2')
  })
})
