import { authSession } from './authSession'
import type { IdentitySnapshot } from './authTypes'

type Change = { type: 'resumes.changed'; version: 1; userId: string; eventId: string; sourceTabId: string }
const sourceTabId = crypto.randomUUID()
const listeners = new Set<() => void>()
const statusListeners = new Set<() => void>()
let available = true
export const businessEventsAvailable = () => available
export function subscribeBusinessEventStatus(listener: () => void) {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}
function setAvailable(value: boolean) {
  if (value === available) return
  available = value
  statusListeners.forEach(listener => listener())
}
let channel: BroadcastChannel | null = null
let identity: IdentitySnapshot | null = null
const seen = new Map<string, number>()
export function subscribeResumeChanges(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notify() { listeners.forEach(listener => { try { listener() } catch { /* Isolate subscribers. */ } }) }
export function connectBusinessEvents(next: IdentitySnapshot) {
  channel?.close()
  identity = next
  seen.clear()
  try {
    const current = new BroadcastChannel(`ai-career-data-v1:${next.userId}`)
    channel = current
    setAvailable(true)
    current.onmessage = ({ data }: MessageEvent<Change>) => {
      if (!authSession.isCurrent(next) || identity !== next || !data || data.type !== 'resumes.changed'
        || data.version !== 1 || data.userId !== next.userId || typeof data.eventId !== 'string'
        || !data.eventId || data.eventId.length > 100 || typeof data.sourceTabId !== 'string'
        || !data.sourceTabId || data.sourceTabId.length > 100 || data.sourceTabId === sourceTabId
        || Object.keys(data).sort().join(',') !== 'eventId,sourceTabId,type,userId,version'
        || seen.has(data.eventId)) return
      for (const [id, timestamp] of seen) if (Date.now() - timestamp > 300_000) seen.delete(id)
      seen.set(data.eventId, Date.now())
      if (seen.size > 256) seen.delete(seen.keys().next().value!)
      notify()
    }
  } catch { channel = null; setAvailable(false) }
  return () => {
    if (identity === next) { channel?.close(); channel = null; identity = null; seen.clear() }
  }
}
export function publishResumeChange(source: IdentitySnapshot) {
  if (!authSession.isCurrent(source)) return
  notify()
  if (identity?.epoch !== source.epoch || identity.userId !== source.userId) return
  try {
    channel?.postMessage({ type: 'resumes.changed', version: 1, userId: source.userId, sourceTabId,
      eventId: crypto.randomUUID() } satisfies Change)
  } catch { setAvailable(false) }
}
if (import.meta.hot) import.meta.hot.dispose(() => { channel?.close(); identity = null; listeners.clear(); statusListeners.clear() })
