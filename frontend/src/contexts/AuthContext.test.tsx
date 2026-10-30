import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { authSession } from '@/lib/authSession'
import { authTransport } from '@/lib/authTransport'
import { apiGetMe } from '@/lib/api'
import { deferred, tokenResponse } from '@/test/authFixtures'
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiGetMe: vi.fn() }))
afterEach(() => { authSession.invalidate(); vi.restoreAllMocks() })
it('starts anonymous, deduplicates profile loading, and retries profile without another login', async () => {
  const login = vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
  const first = deferred<Awaited<ReturnType<typeof apiGetMe>>>()
  vi.mocked(apiGetMe).mockReturnValueOnce(first.promise)
  const { result, unmount } = renderHook(() => useAuth(), { wrapper: AuthProvider })
  expect(result.current.phase).toBe('anonymous')
  expect(apiGetMe).not.toHaveBeenCalled()
  let pending!: Promise<void>
  act(() => { pending = result.current.login('a@example.com', 'password').catch(() => {}) })
  await waitFor(() => expect(apiGetMe).toHaveBeenCalledTimes(1))
  await act(async () => { first.reject(new Error('offline')); await pending })
  expect(result.current.phase).toBe('identityError')
  vi.mocked(apiGetMe).mockResolvedValue({ id: 'user', username: 'user', email: 'a@example.com' })
  await act(async () => { await result.current.retryIdentity() })
  expect(result.current.phase).toBe('authenticated')
  expect(login).toHaveBeenCalledTimes(1)
  unmount()
})
