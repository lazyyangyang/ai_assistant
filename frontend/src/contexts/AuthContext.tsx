import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { apiGetMe, apiLogin, apiRegister, apiLogout, type UserInfo } from '@/lib/api'
import { authSession } from '@/lib/authSession'
import { connectBusinessEvents, businessEventsAvailable, subscribeBusinessEventStatus } from '@/lib/businessEvents'
import type { AuthPhase } from '@/lib/authTypes'

interface AuthState {
  user: UserInfo | null
  loading: boolean
  phase: AuthPhase
  sessionId: string | null
  authError: string | null
  canSubmit: boolean
  retryIdentity: () => Promise<void>
  revalidate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot)
  const synchronizationAvailable = useSyncExternalStore(subscribeBusinessEventStatus, businessEventsAvailable)
  const [profile, setProfile] = useState<{ user: UserInfo; epoch: number } | null>(null)
  const mounted = useRef(false)
  const pending = useRef<{ key: string; promise: Promise<void> } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { void authSession.restore().catch(() => {}) }, [])
  const ensureUser = useCallback((): Promise<void> => {
    const identity = authSession.captureIdentity()
    const key = `${identity.epoch}:${identity.requestGeneration}`
    if (pending.current?.key === key) return pending.current.promise
    const promise = apiGetMe().then(user => {
      if (!authSession.isCurrent(identity) || !mounted.current) return
      if (user.id !== identity.userId) { authSession.invalidate('用户资料身份不匹配'); return }
      setProfile({ user, epoch: identity.epoch })
      authSession.identityLoaded(identity, user.id)
    }).catch(error => {
      authSession.identityFailed(identity, error)
      throw error
    }).finally(() => { if (pending.current?.promise === promise) pending.current = null })
    pending.current = { key, promise }
    return promise
  }, [])
  useEffect(() => {
    if (snapshot.phase === 'identifying') void ensureUser().catch(() => {})
  }, [snapshot.phase, snapshot.epoch, snapshot.requestGeneration, ensureUser])
  useEffect(() => {
    if (!snapshot.sessionId || !snapshot.userId) return
    return connectBusinessEvents(authSession.captureIdentity())
  }, [snapshot.sessionId, snapshot.userId, snapshot.epoch, snapshot.requestGeneration])
  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password)
    await ensureUser()
  }, [ensureUser])
  const register = useCallback(async (username: string, email: string, password: string) => {
    await apiRegister(username, email, password)
  }, [])
  const user = profile?.epoch === snapshot.epoch ? profile.user : null
  return <AuthContext.Provider value={{ user, loading: !user && ['authenticating', 'identifying', 'restoring'].includes(snapshot.phase),
    phase: snapshot.phase, sessionId: snapshot.sessionId, authError: snapshot.error,
    canSubmit: snapshot.phase === 'authenticated', retryIdentity: ensureUser,
    revalidate: () => authSession.revalidate(), login, register, logout: apiLogout }}>
    {children}
    {['restoring', 'restoreError'].includes(snapshot.phase) &&
      <div role="dialog" aria-modal="true" aria-label="恢复登录" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
        <div className="rounded-lg bg-background p-6 shadow-lg space-y-3">
          <p>{snapshot.phase === 'restoring' ? '正在恢复本标签页的登录…' : '暂时无法恢复登录，请重试。'}</p>
          {snapshot.error && <p role="alert">{snapshot.error}</p>}
          <button disabled={snapshot.phase === 'restoring'} onClick={() => void authSession.restore().catch(() => {})}>重试恢复</button>
          <button className="ml-4" onClick={() => authSession.invalidate()}>放弃恢复并重新登录</button>
        </div>
      </div>}
    {user && !synchronizationAvailable && <p role="status" className="fixed bottom-2 right-2 rounded bg-background p-3 shadow">跨页自动更新不可用；可重试同步，或切回页面更新列表。</p>}
    {['identifying', 'identityError', 'logoutUncertain', 'revalidating'].includes(snapshot.phase) &&
      <div role="dialog" aria-modal="true" aria-label="认证状态" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-lg bg-background p-6 shadow-lg space-y-3">
          <p>{snapshot.phase === 'identifying' ? '正在加载用户资料…' : snapshot.phase === 'logoutUncertain' ? '退出结果未确认，当前操作已暂停。' : '请验证当前登录状态后继续。'}</p>
          <p role="alert">{snapshot.error}</p>
          <button disabled={snapshot.phase === 'identifying'} onClick={() => void (snapshot.phase === 'identityError' ? ensureUser() : authSession.revalidate()).catch(() => {})}>验证后继续</button>
          <button className="ml-4" onClick={() => void apiLogout().catch(() => {})}>重试退出</button>
        </div>
      </div>}
  </AuthContext.Provider>
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
