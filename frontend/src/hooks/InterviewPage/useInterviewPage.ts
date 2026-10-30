import { useResumeSelection } from '@/hooks/useResumeSelection'
import { useState } from 'react'
import { useResumesData } from '@/hooks/useResumesData'
import { loadSavedJdResult } from '@/lib/jdStorage'
import type { JDStructuredResult } from '@/types/chat'

export function useInterviewPage() {
  const { resumes, loaded, error: syncError, refresh } = useResumesData()
  const { selectedResumeId, setSelectedResumeId } = useResumeSelection(resumes, loaded)
  const [savedJdContext] = useState<JDStructuredResult | null>(loadSavedJdResult)



  return {
    resumes,
    syncError,
    refresh,
    selectedResumeId,
    setSelectedResumeId,
    savedJdContext,
  }
}
