import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useChatInput } from './useChatInput'
import { authSession } from '@/lib/authSession'
import { authTransport } from '@/lib/authTransport'
import { deferred, tokenResponse } from '@/test/authFixtures'
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))
afterEach(() => { authSession.invalidate(); vi.restoreAllMocks() })
it('stops tracks returned after recorder permission outlives component', async () => {
  vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
  await authSession.login({ email: 'a@example.com', password: 'password' })
  authSession.identityLoaded(authSession.captureIdentity(), 'user')
  const pending = deferred<MediaStream>(), stop = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => pending.promise } })
  const { result, unmount } = renderHook(() => useChatInput({ value: '', onChange: vi.fn(), onSend: vi.fn(), enableVoiceInput: true }))
  let recording!: Promise<void>
  act(() => { recording = result.current.handleVoicePointerDown({ preventDefault() {}, currentTarget: { setPointerCapture() {} }, pointerId: 1 } as never) })
  unmount()
  await act(async () => { pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream); await recording })
  expect(stop).toHaveBeenCalledTimes(1)
})
