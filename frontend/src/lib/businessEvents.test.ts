import { afterEach, expect, it, vi } from 'vitest'
import { authSession } from './authSession'
import { authTransport } from './authTransport'
import { tokenResponse } from '@/test/authFixtures'
import { connectBusinessEvents, publishResumeChange, subscribeResumeChanges } from './businessEvents'
afterEach(() => { authSession.invalidate(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('filters user/schema/duplicates and isolates failed posting from local invalidation', async () => {
  const post = vi.fn((message: unknown) => { void message; throw new Error('unavailable') })
  let receive!: (e: MessageEvent) => void
  vi.stubGlobal('BroadcastChannel', class {
    set onmessage(fn: (e: MessageEvent) => void) { receive = fn }
    postMessage = post
    close() {}
  })
  vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
  await authSession.login({ email: 'a@example.com', password: 'password' })
  authSession.identityLoaded(authSession.captureIdentity(), 'user')
  const identity = authSession.captureIdentity(), disconnect = connectBusinessEvents(identity)
  const listener = vi.fn(), unsubscribe = subscribeResumeChanges(listener)
  const event = { type: 'resumes.changed', sourceTabId: 'other-tab', version: 1, userId: 'user', eventId: 'one' }
  for (const data of [{ ...event, userId: 'other' }, { ...event, token: 'forbidden' }, event, event]) receive({ data } as MessageEvent)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(() => publishResumeChange(identity)).not.toThrow()
  expect(listener).toHaveBeenCalledTimes(2)
  expect(Object.keys(post.mock.calls[0][0] as object).sort()).toEqual(['eventId', 'sourceTabId', 'type', 'userId', 'version'])
  authSession.invalidate(); receive({ data: { ...event, eventId: 'late' } } as MessageEvent)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe(); disconnect()
})
