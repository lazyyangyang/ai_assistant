import { afterEach, expect, it, vi } from 'vitest'
import { ResumeStore } from './resumeStore'
import { apiGetResumes } from './api'
import { deferred } from '@/test/authFixtures'
vi.mock('./api', () => ({ apiGetResumes: vi.fn() }))
vi.mock('./authSession', () => ({ authSession: {
  captureIdentity: () => ({}), isCurrent: () => true, canRequest: () => true, subscribe: () => () => {},
} }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('coalesces 200ms events, follows an in-flight dirty update, retains data on failure without loops', async () => {
  vi.useFakeTimers()
  const store = new ResumeStore(), stop = store.start(), unconsume = store.consume()
  const first = deferred<Awaited<ReturnType<typeof apiGetResumes>>>()
  vi.mocked(apiGetResumes).mockReturnValueOnce(first.promise).mockResolvedValueOnce([])
  store.invalidate(); store.invalidate()
  await vi.advanceTimersByTimeAsync(199)
  expect(apiGetResumes).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  store.invalidate(); store.invalidate()
  expect(apiGetResumes).toHaveBeenCalledTimes(1)
  first.resolve([])
  await vi.advanceTimersByTimeAsync(200)
  expect(apiGetResumes).toHaveBeenCalledTimes(2)
  expect(store.getSnapshot().stale).toBe(false)
  vi.mocked(apiGetResumes).mockRejectedValue(new Error('offline'))
  store.invalidate(); await vi.advanceTimersByTimeAsync(20_000)
  expect(apiGetResumes).toHaveBeenCalledTimes(3)
  expect(store.getSnapshot()).toMatchObject({ loaded: true, stale: true, error: 'offline', resumes: [] })
  unconsume(); store.invalidate(); await vi.advanceTimersByTimeAsync(1000)
  expect(apiGetResumes).toHaveBeenCalledTimes(3)
  stop()
  expect(vi.getTimerCount()).toBe(0)
})
