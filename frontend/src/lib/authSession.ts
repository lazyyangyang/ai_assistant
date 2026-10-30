import axios from 'axios'
import { authTransport } from './authTransport'
import type { AuthSnapshot, AuthTransport, IdentitySnapshot, TokenResponse } from './authTypes'
import { cancelRequests } from './requestScope'
import { createSessionRecovery, type SessionRecovery } from './sessionRecovery'

export function tokenClaims(token: string | null): { sub: string; sid: string; exp: number } | null {
  try {
    const c = JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof c.sub === 'string' && /^[0-9a-f]{32}$/.test(c.sid) && Number.isFinite(c.exp) ? c : null
  } catch { return null }
}

/** Access tokens belong to one document; only the session selector survives reload. */
export class AuthSession {
  private token: string | null = null
  private snapshot: AuthSnapshot = { phase: 'anonymous', sessionId: null, userId: null,
    epoch: 0, requestGeneration: 0, error: null }
  private listeners = new Set<() => void>()
  private tail: Promise<unknown> = Promise.resolve()
  private pendingRefresh: Promise<string> | null = null
  private pendingRestore: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller = new AbortController()
  private disposed = false
  private failures = 0
  private retryAt = 0
  private transport: AuthTransport
  private visible: () => boolean
  private recovery: SessionRecovery
  constructor(transport: AuthTransport = authTransport,
    visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    recovery: SessionRecovery = createSessionRecovery()) {
    this.transport = transport
    this.visible = visible
    this.recovery = recovery
    const sid = recovery.read()
    if (sid) this.snapshot = { ...this.snapshot, phase: 'restoring', sessionId: sid }
  }
  getSnapshot = () => this.snapshot
  getToken = () => this.token
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(values: Partial<AuthSnapshot>) {
    this.snapshot = { ...this.snapshot, ...values }
    this.listeners.forEach(listener => listener())
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work)
    this.tail = task.catch(() => {})
    return task
  }
  captureIdentity(): IdentitySnapshot {
    const s = this.snapshot
    if (!s.sessionId || !s.userId || this.disposed) throw new axios.CanceledError('请重新登录')
    return { sessionId: s.sessionId, userId: s.userId, epoch: s.epoch, requestGeneration: s.requestGeneration }
  }
  isCurrent = (i: IdentitySnapshot) => !this.disposed && i.epoch === this.snapshot.epoch
    && i.sessionId === this.snapshot.sessionId && i.userId === this.snapshot.userId
    && i.requestGeneration === this.snapshot.requestGeneration
  canRequest(internal = false) {
    return this.snapshot.phase === 'authenticated' || (internal && ['identifying', 'identityError'].includes(this.snapshot.phase))
  }
  private checkResponse(result: TokenResponse, expected?: IdentitySnapshot) {
    const claims = tokenClaims(result.access_token)
    if (!claims || result.token_type !== 'bearer' || !(result.expires_in > 0)
      || result.session_id !== claims.sid || claims.exp * 1000 <= Date.now()
      || (expected && (claims.sid !== expected.sessionId || claims.sub !== expected.userId))) {
      this.invalidate('认证响应身份不匹配，请重新登录')
      throw new Error('认证响应身份不匹配')
    }
    this.token = result.access_token
    this.failures = 0
    this.retryAt = 0
    return claims
  }
  restore(): Promise<void> {
    if (this.pendingRestore) return this.pendingRestore
    if (this.disposed || !['restoring', 'restoreError'].includes(this.snapshot.phase)) return Promise.resolve()
    const sid = this.snapshot.sessionId!, epoch = this.snapshot.epoch
    this.update({ phase: 'restoring', error: null })
    const task = this.queue(async () => {
      try {
        const result = await this.transport.refresh(sid, this.controller.signal)
        if (this.disposed || epoch !== this.snapshot.epoch || this.snapshot.phase !== 'restoring') throw new axios.CanceledError()
        if (result.session_id !== sid) {
          this.invalidate('恢复的登录会话不匹配，请重新登录')
          throw new Error('恢复的登录会话不匹配')
        }
        const claims = this.checkResponse(result)
        this.update({ phase: 'identifying', userId: claims.sub, epoch: epoch + 1 })
      } catch (error) {
        if (!this.disposed && epoch === this.snapshot.epoch && this.snapshot.phase === 'restoring') {
          if (axios.isAxiosError(error) && error.response?.status === 401) this.invalidate('登录已过期，请重新登录')
          else this.update({ phase: 'restoreError', error: (error as Error).message })
        }
        throw error
      }
    }).finally(() => { if (this.pendingRestore === task) this.pendingRestore = null })
    this.pendingRestore = task
    return task
  }
  login(input: { email: string; password: string }) {
    if (this.disposed || this.snapshot.phase !== 'anonymous') return Promise.reject(new Error('请先完成当前登录或退出'))
    const epoch = this.snapshot.epoch
    this.update({ phase: 'authenticating', error: null })
    return this.queue(async () => {
      try {
        const result = await this.transport.login(input, this.controller.signal)
        if (this.disposed || epoch !== this.snapshot.epoch) throw new axios.CanceledError()
        const claims = this.checkResponse(result)
        this.recovery.save(claims.sid)
        this.update({ phase: 'identifying', sessionId: claims.sid, userId: claims.sub, epoch: epoch + 1 })
        return result
      } catch (error) {
        if (!this.disposed && epoch === this.snapshot.epoch) this.update({ phase: 'anonymous', error: (error as Error).message })
        throw error
      }
    })
  }
  identityLoaded(identity: IdentitySnapshot, userId: string) {
    if (!this.isCurrent(identity) || !['identifying', 'identityError'].includes(this.snapshot.phase)) return
    if (userId !== identity.userId) { this.invalidate('用户资料身份不匹配'); return }
    this.update({ phase: 'authenticated', error: null })
    this.recovery.save(identity.sessionId)
    this.schedule()
  }
  identityFailed(identity: IdentitySnapshot, error: unknown) {
    if (this.isCurrent(identity) && ['identifying', 'identityError'].includes(this.snapshot.phase)) {
      this.update({ phase: 'identityError', error: (error as Error).message })
    }
  }
  private fresh() { return (tokenClaims(this.token)?.exp ?? 0) * 1000 > Date.now() + 60_000 }
  private schedule() {
    clearTimeout(this.timer)
    if (this.disposed || !this.visible() || this.snapshot.phase !== 'authenticated') return
    const delay = Math.max(1000, (tokenClaims(this.token)?.exp ?? 0) * 1000 - Date.now() - 60_000, this.retryAt - Date.now())
    this.timer = setTimeout(() => { void this.refresh().catch(() => {}) }, Math.min(delay, 2_147_483_647))
  }
  refresh(options: { rejectedToken?: string; force?: boolean } = {}): Promise<string> {
    if (!this.snapshot.sessionId || this.disposed || ['loggingOut', 'logoutUncertain'].includes(this.snapshot.phase)) {
      return Promise.reject(new axios.CanceledError('当前会话不可刷新'))
    }
    if (!options.force && this.fresh() && this.token !== options.rejectedToken) return Promise.resolve(this.token!)
    if (this.pendingRefresh) return this.pendingRefresh
    if (!options.force && Date.now() < this.retryAt) return Promise.reject(new Error('登录刷新暂不可用，请稍后重试'))
    const identity = this.captureIdentity()
    const task = this.queue(async () => {
      if (!this.isCurrent(identity)) throw new axios.CanceledError()
      const result = await this.transport.refresh(identity.sessionId, this.controller.signal)
      if (this.disposed || this.snapshot.epoch !== identity.epoch) throw new axios.CanceledError()
      this.checkResponse(result, identity)
      this.schedule()
      return this.token!
    }).catch((error: unknown) => {
      if (this.isCurrent(identity) && !axios.isCancel(error)) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        if (status === 401) this.invalidate('登录已过期，请重新登录')
        else if (status === 403) this.block('revalidating', '认证配置错误，请检查请求来源后重试')
        else {
          this.retryAt = Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(this.failures++, 4))
          if ((tokenClaims(this.token)?.exp ?? 0) * 1000 <= Date.now()) this.block('revalidating', (error as Error).message)
          else this.schedule()
        }
      }
      throw error
    }).finally(() => { if (this.pendingRefresh === task) this.pendingRefresh = null })
    this.pendingRefresh = task
    return task
  }
  async beforeRequest() {
    try { await this.refresh() } catch (error) {
      if (!this.canRequest(true) || (tokenClaims(this.token)?.exp ?? 0) * 1000 <= Date.now()) throw error
    }
  }
  private block(phase: 'loggingOut' | 'revalidating', error: string | null = null) {
    clearTimeout(this.timer)
    this.update({ phase, error, requestGeneration: this.snapshot.requestGeneration + 1 })
    cancelRequests()
  }
  logout() {
    if (!this.snapshot.sessionId || this.snapshot.phase === 'loggingOut') return Promise.reject(new Error('当前无法退出'))
    const sid = this.snapshot.sessionId, epoch = this.snapshot.epoch
    // Reload must not silently undo a user's pending/uncertain logout.
    this.recovery.clear()
    this.block('loggingOut')
    return this.queue(async () => {
      try {
        await this.transport.logout(sid, this.controller.signal)
        if (!this.disposed && this.snapshot.epoch === epoch) this.invalidate('')
      } catch (error) {
        if (!this.disposed && this.snapshot.epoch === epoch) this.update({ phase: 'logoutUncertain', error: (error as Error).message })
        throw error
      }
    })
  }
  async revalidate() {
    if (!this.snapshot.sessionId || ['loggingOut', 'authenticating'].includes(this.snapshot.phase)) return
    this.block('revalidating')
    await this.tail
    if (!this.snapshot.sessionId) return
    const identity = this.captureIdentity()
    try {
      await this.refresh({ force: true })
      if (this.isCurrent(identity)) this.update({ phase: 'identifying', error: null })
    } catch (error) {
      if (this.isCurrent(identity)) this.update({ error: (error as Error).message })
      throw error
    }
  }
  suspend() { if (this.snapshot.sessionId) this.block('revalidating') }
  wake() {
    clearTimeout(this.timer)
    if (this.visible() && this.snapshot.phase === 'authenticated') void this.refresh().then(() => this.schedule()).catch(() => {})
  }
  invalidate(reason = '', clearRecovery = true) {
    if (clearRecovery) this.recovery.clear()
    this.token = null
    this.retryAt = 0
    clearTimeout(this.timer)
    cancelRequests()
    this.update({ phase: 'anonymous', sessionId: null, userId: null, error: reason || null,
      epoch: this.snapshot.epoch + 1, requestGeneration: this.snapshot.requestGeneration + 1 })
  }
  dispose() {
    this.disposed = true
    this.controller.abort()
    this.invalidate('', false)
    this.listeners.clear()
  }
}
export const authSession = new AuthSession()
const wake = () => authSession.wake()
const hide = () => authSession.suspend()
const show = (event: PageTransitionEvent) => {
  if (event.persisted) void authSession.revalidate().catch(() => {})
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  authSession.dispose()
  window.removeEventListener('focus', wake)
  window.removeEventListener('online', wake)
  document.removeEventListener('visibilitychange', wake)
  window.removeEventListener('pagehide', hide)
  window.removeEventListener('pageshow', show)
})
