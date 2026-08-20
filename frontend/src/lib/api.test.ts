import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiGetMe,
  clearAccessToken,
  setAccessToken,
  setAuthFailureHandler,
} from './api'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('authenticated API requests', () => {
  beforeEach(() => {
    clearAccessToken()
    setAuthFailureHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes once and retries a request after a 401 response', async () => {
    setAccessToken('expired-access-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new-access-token', token_type: 'bearer' }))
      .mockResolvedValueOnce(jsonResponse({ id: '1', username: 'demo', email: 'demo@example.com' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetMe()).resolves.toMatchObject({ username: 'demo' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')

    const retryOptions = fetchMock.mock.calls[2][1] as RequestInit
    expect(new Headers(retryOptions.headers).get('Authorization')).toBe('Bearer new-access-token')
    expect(retryOptions.credentials).toBe('include')
  })

  it('shares one refresh request across concurrent 401 responses', async () => {
    setAccessToken('expired-access-token')
    let refreshCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/refresh') {
        refreshCalls += 1
        return jsonResponse({ access_token: 'new-access-token', token_type: 'bearer' })
      }

      const token = new Headers(init?.headers).get('Authorization')
      if (token === 'Bearer expired-access-token') {
        return new Response(null, { status: 401 })
      }
      return jsonResponse({ id: '1', username: 'demo', email: 'demo@example.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiGetMe(), apiGetMe()])
    expect(refreshCalls).toBe(1)
  })

  it('notifies the auth context when refresh fails', async () => {
    setAccessToken('expired-access-token')
    const onAuthFailure = vi.fn()
    setAuthFailureHandler(onAuthFailure)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    )

    await expect(apiGetMe()).rejects.toThrow('HTTP 401')
    expect(onAuthFailure).toHaveBeenCalledTimes(1)
  })
})
