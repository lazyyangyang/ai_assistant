import { apiGetResumes, type ResumeDTO } from './api'
import { authSession } from './authSession'
import { subscribeResumeChanges } from './businessEvents'

export class ResumeStore {
  private state = { resumes: [] as ResumeDTO[], loading: false, refreshing: false, stale: true, error: '', loaded: false }
  private listeners = new Set<() => void>()
  private consumers = 0
  private dirty = 0
  private pending: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | null = null
  private active = false
  private generation = 0
  private unsubscribe: (() => void) | undefined
  private authUnsubscribe: (() => void) | undefined
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(values: Partial<typeof this.state>) {
    this.state = { ...this.state, ...values }; this.listeners.forEach(listener => listener())
  }
  private eligible = () => this.active && this.consumers > 0 && document.visibilityState !== 'hidden'
    && navigator.onLine !== false && authSession.canRequest()
  start() {
    this.active = true
    this.unsubscribe = subscribeResumeChanges(this.invalidate)
    this.authUnsubscribe = authSession.subscribe(() => { if (this.eligible()) this.invalidate() })
    window.addEventListener('online', this.invalidate)
    window.addEventListener('focus', this.invalidate)
    document.addEventListener('visibilitychange', this.invalidate)
    if (this.consumers) this.invalidate()
    return () => this.stop()
  }
  stop() {
    this.active = false; this.generation++
    clearTimeout(this.timer); this.timer = undefined
    this.controller?.abort(); this.pending = null
    this.unsubscribe?.(); this.authUnsubscribe?.()
    window.removeEventListener('online', this.invalidate)
    window.removeEventListener('focus', this.invalidate)
    document.removeEventListener('visibilitychange', this.invalidate)
  }
  consume = () => {
    this.consumers++
    if (this.state.stale) this.schedule()
    return () => { this.consumers--; if (!this.consumers) { clearTimeout(this.timer); this.timer = undefined } }
  }
  invalidate = () => { this.dirty++; this.update({ stale: true }); this.schedule() }
  private schedule() {
    if (!this.eligible() || this.pending || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh() }, 200)
  }
  refresh = (): Promise<void> => {
    if (this.pending) return this.pending
    if (!this.eligible()) return Promise.resolve()
    clearTimeout(this.timer); this.timer = undefined
    const version = this.dirty, generation = this.generation
    const identity = authSession.captureIdentity()
    const controller = new AbortController(); this.controller = controller
    this.update({ loading: !this.state.loaded, refreshing: this.state.loaded, error: '' })
    let succeeded = false
    const task = apiGetResumes({ signal: controller.signal }).then(resumes => {
      if (!this.active || generation !== this.generation || !authSession.isCurrent(identity)) return
      succeeded = true
      this.update({ resumes, loaded: true, stale: version !== this.dirty })
    }).catch(error => {
      if (!this.active || generation !== this.generation || !authSession.isCurrent(identity)) return
      this.update({ stale: true, error: (error as Error).message })
    }).finally(() => {
      if (generation !== this.generation) return
      this.pending = null
      this.update({ loading: false, refreshing: false })
      if (succeeded && version !== this.dirty) this.schedule()
    })
    this.pending = task
    return task
  }
}
