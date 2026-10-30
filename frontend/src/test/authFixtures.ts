import { vi } from 'vitest'
import type { AuthTransport } from '@/lib/authTypes'
export const sid = 'a'.repeat(32)
export function tokenResponse(seconds = 900, session_id = sid, sub = 'user') {
  return { session_id, token_type: 'bearer', expires_in: seconds,
    access_token: `header.${btoa(JSON.stringify({ sub, sid: session_id, exp: Math.floor(Date.now() / 1000) + seconds }))}.signature` }
}
export function transport(): AuthTransport {
  return { login: vi.fn(async () => tokenResponse()), refresh: vi.fn(async () => tokenResponse()), logout: vi.fn(async () => {}) }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
