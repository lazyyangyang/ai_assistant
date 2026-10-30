import { afterEach, expect, it, vi } from 'vitest'
import { authSession } from './authSession'
import { authTransport } from './authTransport'
import { tokenResponse } from '@/test/authFixtures'
import { saveJdResult, loadSavedJdResult } from './jdStorage'
const result = { skills: ['React'], responsibilities: [], hard_requirements: [], summary: 'JD' }
afterEach(() => { authSession.invalidate(); vi.restoreAllMocks() })
it('ignores legacy storage, copies data, clears on same-user new session', async () => {
  localStorage.setItem('saved_jd_result', JSON.stringify(result))
  expect(loadSavedJdResult()).toBeNull()
  vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
  await authSession.login({ email: 'a@example.com', password: 'password' })
  authSession.identityLoaded(authSession.captureIdentity(), 'user')
  saveJdResult(result)
  const copy = loadSavedJdResult()!; copy.skills.push('modified')
  expect(loadSavedJdResult()?.skills).toEqual(['React'])
  authSession.invalidate()
  vi.mocked(authTransport.login).mockResolvedValue(tokenResponse(900, 'b'.repeat(32)))
  await authSession.login({ email: 'a@example.com', password: 'password' })
  expect(loadSavedJdResult()).toBeNull()
  expect(localStorage.getItem('saved_jd_result')).not.toBeNull()
})
