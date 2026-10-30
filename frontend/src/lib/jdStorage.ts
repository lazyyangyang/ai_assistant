import type { JDStructuredResult } from '@/types/chat'

import { authSession } from './authSession'
import type { IdentitySnapshot } from './authTypes'
let slot: { identity: IdentitySnapshot; result: JDStructuredResult } | null = null
const unsubscribe = authSession.subscribe(() => {
  if (slot && (slot.identity.epoch !== authSession.getSnapshot().epoch)) slot = null
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
export function saveJdResult(result: JDStructuredResult) {
  if (!authSession.canRequest()) return
  slot = { identity: authSession.captureIdentity(), result: structuredClone(result) }
}
export function loadSavedJdResult(): JDStructuredResult | null {
  if (!slot || slot.identity.epoch !== authSession.getSnapshot().epoch ||
    slot.identity.sessionId !== authSession.getSnapshot().sessionId) return null
  return structuredClone(slot.result)
}

export function hasMeaningfulJdResult(result: JDStructuredResult | null) {
  return !!(
    result &&
    (
      result.skills.length > 0 ||
      result.responsibilities.length > 0 ||
      result.hard_requirements.length > 0 ||
      result.summary
    )
  )
}
