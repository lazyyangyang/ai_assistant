import type { JDStructuredResult } from '@/types/chat'

const SAVED_JD_KEY = 'saved_jd_result'

export function saveJdResult(result: JDStructuredResult) {
  // Persist only after the user explicitly saves; transient extraction output
  // remains in Zustand and is cleared with the authenticated chat session.
  localStorage.setItem(SAVED_JD_KEY, JSON.stringify(result))
}

export function loadSavedJdResult(): JDStructuredResult | null {
  const raw = localStorage.getItem(SAVED_JD_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as JDStructuredResult
  } catch {
    // Corrupt or manually edited browser storage should degrade to no context,
    // not prevent resume and interview pages from loading.
    return null
  }
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
