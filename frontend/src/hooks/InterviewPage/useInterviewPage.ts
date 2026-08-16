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
        const active = list.find((item) => item.is_active)
        setSelectedResumeId(active?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setSavedJdContext(loadSavedJdResult())
  }, [])

  return {
    resumes,
    selectedResumeId,
    setSelectedResumeId,
    savedJdContext,
  }
}
