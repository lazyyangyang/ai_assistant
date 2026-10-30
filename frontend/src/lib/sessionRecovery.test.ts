import { afterEach, expect, it, vi } from 'vitest'
import { createSessionRecovery, RECOVERY_KEY } from './sessionRecovery'

afterEach(() => { sessionStorage.clear(); localStorage.clear() })
it('persists only the selector across reload and never writes localStorage', () => {
  const write = vi.spyOn(localStorage, 'setItem')
  const store = createSessionRecovery(() => sessionStorage, () => 'reload')
  store.save('a'.repeat(32))
  expect(store.read()).toBe('a'.repeat(32))
  expect(Object.keys(sessionStorage)).toEqual([RECOVERY_KEY])
  expect(sessionStorage.getItem(RECOVERY_KEY)).toBe('a'.repeat(32))
  expect(write).not.toHaveBeenCalled()
  store.clear()
  expect(store.read()).toBeNull()
  write.mockRestore()
})
it.each(['navigate', 'back_forward', undefined] as const)('discards copied selectors on %s', type => {
  sessionStorage.setItem(RECOVERY_KEY, 'a'.repeat(32))
  const store = createSessionRecovery(() => sessionStorage, () => type)
  expect(store.read()).toBeNull()
  expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull()
})
it('rejects malformed selectors and tolerates disabled storage', () => {
  sessionStorage.setItem(RECOVERY_KEY, '../invalid')
  expect(createSessionRecovery(() => sessionStorage, () => 'reload').read()).toBeNull()
  const store = createSessionRecovery(() => { throw new Error('denied') })
  expect(store.read()).toBeNull()
  expect(() => { store.save('a'.repeat(32)); store.clear() }).not.toThrow()
})
