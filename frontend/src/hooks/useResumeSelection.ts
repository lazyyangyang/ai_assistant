import { useState } from 'react'
import type { ResumeDTO } from '@/lib/api'
/** Initial default once; later deletion clears selection without choosing a fallback. */
export function useResumeSelection(resumes: ResumeDTO[], loaded: boolean) {
  const [previous, setPrevious] = useState<ResumeDTO[] | null>(null)
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  if (loaded && previous !== resumes) {
    setPrevious(resumes)
    if (previous === null) setSelectedResumeId(resumes.find(item => item.is_active)?.id ?? resumes[0]?.id ?? null)
    else if (selectedResumeId && !resumes.some(item => item.id === selectedResumeId)) setSelectedResumeId(null)
  }
  return { selectedResumeId, setSelectedResumeId }
}
