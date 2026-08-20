import { useEffect, useState } from 'react'
import { apiGetResumes, type ResumeDTO } from '@/lib/api'
import { loadSavedJdResult } from '@/lib/jdStorage'
import type { JDStructuredResult } from '@/types/chat'

export function useInterviewPage() {
  const [resumes, setResumes] = useState<ResumeDTO[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [savedJdContext, setSavedJdContext] = useState<JDStructuredResult | null>(null)

  useEffect(() => {
    apiGetResumes()
      .then((list) => {
        setResumes(list)
        // The active resume is the global default context; the user can still
        // override it locally for this interview without mutating resume metadata.
        const active = list.find((item) => item.is_active)
        setSelectedResumeId(active?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    // JD is loaded independently from resume selection so an interview can use
    // both contexts while keeping their persistence lifecycles separate.
    setSavedJdContext(loadSavedJdResult())
  }, [])

  return {
    resumes,
    selectedResumeId,
    setSelectedResumeId,
    savedJdContext,
  }
}
