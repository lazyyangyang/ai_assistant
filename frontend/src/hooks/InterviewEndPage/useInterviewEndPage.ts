import { useOperationGuard } from '@/hooks/useOperationGuard'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiGetChatSessions } from '@/lib/api'
import type { InterviewFeedback } from '@/types/chat'

export function useInterviewEndPage() {
  const begin = useOperationGuard()
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(!!sessionId)
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [rawFeedback, setRawFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const operation = begin()
    apiGetChatSessions({ signal: operation.signal })
      .then((list) => {
        if (!operation.current()) return
        const session = list.find((s) => s.id === sessionId)
        if (!session?.feedback) return

        setRawFeedback(session.feedback)
        try {
          setFeedback(JSON.parse(session.feedback) as InterviewFeedback)
        } catch {
          setFeedback(null)
        }
      })
      .catch(() => {})
      .finally(() => { if (operation.current()) setLoading(false); operation.release() })
  }, [sessionId, begin])

  const overallScore = useMemo(() => {
    if (!feedback) return null
    const v = feedback.overallScore
    return typeof v === 'number' ? v : null
  }, [feedback])

  const goBackToInterview = () => {
    navigate('/interview')
  }

  return {
    loading,
    feedback,
    rawFeedback,
    overallScore,
    goBackToInterview,
  }
}
