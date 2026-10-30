// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { AuthSession } from './authSession'
import { deferred, tokenResponse, transport } from '@/test/authFixtures'
import type { SessionRecovery } from './sessionRecovery'
const sessions: AuthSession[] = []
const input = { email: 'test@example.com', password: 'password' }
function make(t = transport(), visible?: () => boolean, recovery?: SessionRecovery) {
  const s = new AuthSession(t, visible, recovery); sessions.push(s); return s
}
async function login(s: AuthSession) {
  await s.login(input); s.identityLoaded(s.captureIdentity(), 'user')
}
afterEach(() => { sessions.splice(0).forEach(s => s.dispose()); vi.useRealTimers() })
it('new documents never refresh anonymously and instances stay independent', async () => {
  const t = transport(), a = make(t), b = make(t)
  await expect(a.refresh()).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(t.refresh).not.toHaveBeenCalled()
  await login(a)
  expect(b.getToken()).toBeNull()
  await login(b)
  await a.logout()
  expect(b.getSnapshot().phase).toBe('authenticated')
})
it('coalesces requests within one page without waiting for another page', async () => {
  const t = transport(), a = make(t), b = make()
  await login(a); await login(b)
  const delay = deferred<ReturnType<typeof tokenResponse>>()
  vi.mocked(t.refresh).mockReturnValue(delay.promise)
  const pending = Array.from({ length: 20 }, () => a.refresh({ force: true }))
  await b.refresh({ force: true })
  delay.resolve(tokenResponse())
  await Promise.all(pending)
  expect(t.refresh).toHaveBeenCalledTimes(1)
})
it('refreshes early and catches up on visibility restore', async () => {
  vi.useFakeTimers()
  let visible = true
  const t = transport(); vi.mocked(t.login).mockResolvedValue(tokenResponse(120))
  const s = make(t, () => visible); await login(s)
  visible = false; s.wake()
  await vi.advanceTimersByTimeAsync(150_000)
  expect(t.refresh).not.toHaveBeenCalled()
  visible = true; s.wake()
  await vi.advanceTimersByTimeAsync(0)
  expect(t.refresh).toHaveBeenCalledTimes(1)
  expect(s.getSnapshot().phase).toBe('authenticated')
})
it('backs off only this page and retains an unexpired token', async () => {
  vi.useFakeTimers()
  const t = transport(); vi.mocked(t.login).mockResolvedValue(tokenResponse(30))
  vi.mocked(t.refresh).mockRejectedValue(new Error('offline'))
  const s = make(t); await login(s)
  await s.beforeRequest(); await s.beforeRequest()
  expect(t.refresh).toHaveBeenCalledTimes(1)
  expect(s.getToken()).toBeTruthy()
  await vi.advanceTimersByTimeAsync(5000)
  expect(t.refresh).toHaveBeenCalledTimes(2)
})
it('double login creates one session; profile errors allow retry without login', async () => {
  const t = transport(), s = make(t)
  const first = s.login(input)
  await expect(s.login(input)).rejects.toThrow()
  await first
  const identity = s.captureIdentity()
  s.identityFailed(identity, new Error('offline'))
  expect(s.getSnapshot().phase).toBe('identityError')
  s.identityLoaded(identity, 'user')
  expect(s.getSnapshot().phase).toBe('authenticated')
  expect(t.login).toHaveBeenCalledTimes(1)
})
it('logout closes admission immediately and waits for refresh without reopening the gate', async () => {
  const t = transport(), s = make(t); await login(s)
  const delay = deferred<ReturnType<typeof tokenResponse>>()
  vi.mocked(t.refresh).mockReturnValue(delay.promise)
  const refresh = s.refresh({ force: true }); await Promise.resolve()
  const logout = s.logout()
  expect(s.canRequest()).toBe(false)
  delay.resolve(tokenResponse()); await refresh; await logout
  expect(s.getToken()).toBeNull()
  expect(t.logout).toHaveBeenCalledTimes(1)
})
it.each([401, 403, 500])('logout %i never claims success or permits a new login', async status => {
  const t = transport(), s = make(t); await login(s)
  vi.mocked(t.logout).mockRejectedValue(new AxiosError('refused', '', undefined, undefined,
    { status, data: {}, statusText: '', headers: {}, config: { headers: {} } as never }))
  await expect(s.logout()).rejects.toThrow()
  expect(s.getSnapshot().phase).toBe('logoutUncertain')
  await expect(s.login(input)).rejects.toThrow()
  await s.revalidate()
  s.identityLoaded(s.captureIdentity(), 'user')
  expect(s.getSnapshot().phase).toBe('authenticated')
})
it('late refresh cannot resurrect cleared identity; mismatched sub invalidates', async () => {
  const t = transport(), s = make(t); await login(s)
  const delay = deferred<ReturnType<typeof tokenResponse>>()
  vi.mocked(t.refresh).mockReturnValue(delay.promise)
  const pending = s.refresh({ force: true }); await Promise.resolve()
  s.invalidate(); delay.resolve(tokenResponse())
  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(s.getToken()).toBeNull()
  await login(s)
  vi.mocked(t.refresh).mockResolvedValue(tokenResponse(900, 'a'.repeat(32), 'other'))
  await expect(s.refresh({ force: true })).rejects.toThrow('身份不匹配')
  expect(s.getToken()).toBeNull()
})
it('dispose aborts transports and removes timers and notifications', async () => {
  vi.useFakeTimers()
  const s = make(); await login(s)
  const listener = vi.fn(); s.subscribe(listener); s.dispose(); listener.mockClear()
  await vi.advanceTimersByTimeAsync(1_000_000)
  expect(listener).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

function recovery(sid: string | null = null): SessionRecovery {
  let saved = sid
  return { read: () => saved, save: vi.fn(value => { saved = value }), clear: vi.fn(() => { saved = null }) }
}
it('reload restores the same sid once, waits for profile, and retains no persisted token', async () => {
  const store = recovery(), first = make(transport(), undefined, store)
  await login(first)
  expect(store.save).toHaveBeenCalledWith('a'.repeat(32))
  first.dispose()
  const t = transport(), second = make(t, undefined, store)
  expect(second.getSnapshot().phase).toBe('restoring')
  expect(second.getToken()).toBeNull()
  expect(second.canRequest()).toBe(false)
  await Promise.all([second.restore(), second.restore()])
  expect(t.refresh).toHaveBeenCalledTimes(1)
  expect(t.login).not.toHaveBeenCalled()
  expect(second.getSnapshot().phase).toBe('identifying')
  expect(second.canRequest()).toBe(false)
  second.identityLoaded(second.captureIdentity(), 'user')
  expect(second.getSnapshot().phase).toBe('authenticated')
})
it('a transient recovery failure keeps the selector and allows retry', async () => {
  const store = recovery('a'.repeat(32)), t = transport(), s = make(t, undefined, store)
  vi.mocked(t.refresh).mockRejectedValueOnce(new Error('offline'))
  await expect(s.restore()).rejects.toThrow('offline')
  expect(s.getSnapshot().phase).toBe('restoreError')
  expect(store.read()).toBe('a'.repeat(32))
  await expect(s.login(input)).rejects.toThrow()
  await s.restore()
  expect(s.getSnapshot().phase).toBe('identifying')
})
it('expired recovery clears the selector without falling back to another session', async () => {
  const store = recovery('a'.repeat(32)), t = transport(), s = make(t, undefined, store)
  vi.mocked(t.refresh).mockRejectedValue(new AxiosError('expired', '', undefined, undefined,
    { status: 401, data: {}, statusText: '', headers: {}, config: { headers: {} } as never }))
  await expect(s.restore()).rejects.toThrow()
  expect(s.getSnapshot().phase).toBe('anonymous')
  expect(store.read()).toBeNull()
  expect(s.getToken()).toBeNull()
  expect(t.refresh).toHaveBeenCalledTimes(1)
})
it('rejects another sid during recovery', async () => {
  const store = recovery('b'.repeat(32)), s = make(transport(), undefined, store)
  await expect(s.restore()).rejects.toThrow('不匹配')
  expect(store.read()).toBeNull()
  expect(s.getToken()).toBeNull()
})
it('abandoned recovery cannot resurrect identity when its response arrives late', async () => {
  const t = transport(), store = recovery('a'.repeat(32)), s = make(t, undefined, store)
  const delayed = deferred<ReturnType<typeof tokenResponse>>()
  vi.mocked(t.refresh).mockReturnValue(delayed.promise)
  const pending = s.restore(); await Promise.resolve()
  s.invalidate(); delayed.resolve(tokenResponse())
  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(s.getSnapshot().phase).toBe('anonymous')
  expect(store.read()).toBeNull()
  expect(s.getToken()).toBeNull()
})
it('uncertain logout cannot auto-restore on reload; explicit revalidation restores the selector', async () => {
  const store = recovery(), t = transport(), s = make(t, undefined, store)
  await login(s)
  vi.mocked(t.logout).mockRejectedValue(new Error('offline'))
  await expect(s.logout()).rejects.toThrow()
  expect(store.read()).toBeNull()
  expect(make(transport(), undefined, store).getSnapshot().phase).toBe('anonymous')
  await s.revalidate(); s.identityLoaded(s.captureIdentity(), 'user')
  expect(store.read()).toBe('a'.repeat(32))
})
