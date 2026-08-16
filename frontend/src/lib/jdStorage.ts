import type { JDStructuredResult } from '@/types/chat'

const SAVED_JD_KEY = 'saved_jd_result'

export function saveJdResult(result: JDStructuredResult) {
  localStorage.setItem(SAVED_JD_KEY, JSON.stringify(result))
}

export function loadSavedJdResult(): JDStructuredResult | null {
  const raw = localStorage.getItem(SAVED_JD_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as JDStructuredResult
  } catch {
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
