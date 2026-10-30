/** Only a session selector is persisted. Tokens and user profiles stay in memory. */
export const RECOVERY_KEY = 'ai-career-session-id-v1'
export interface SessionRecovery {
  read(): string | null
  save(sid: string): void
  clear(): void
}

export function createSessionRecovery(
  storage: () => Storage = () => window.sessionStorage,
  navigationType = () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type,
): SessionRecovery {
  const clear = () => { try { storage().removeItem(RECOVERY_KEY) } catch { /* Storage may be disabled. */ } }
  return {
    read() {
      try {
        const sid = storage().getItem(RECOVERY_KEY)
        // A newly opened page can inherit its opener's sessionStorage. Never
        // adopt that selector on a normal navigation (or an unknown lifecycle).
        if (navigationType() === 'reload' && sid && /^[0-9a-f]{32}$/.test(sid)) return sid
        clear()
      } catch { /* Fall back to explicit login without persisting credentials elsewhere. */ }
      return null
    },
    save(sid) { try { storage().setItem(RECOVERY_KEY, sid) } catch { /* Login remains usable in memory. */ } },
    clear,
  }
}
