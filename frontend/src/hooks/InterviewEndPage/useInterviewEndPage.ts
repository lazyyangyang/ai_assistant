import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiGetChatSessions } from '@/lib/api'
import type { InterviewFeedback } from '@/types/chat'

export function useInterviewEndPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [rawFeedback, setRawFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      return
    }

    apiGetChatSessions()
      .then((list) => {
        const session = list.find((s) => s.id === sessionId)
        if (!session?.feedback) return

        setRawFeedback(session.feedback)
        try {
          setFeedback(JSON.parse(session.feedback) as InterviewFeedback)
        } catch {
          setFeedback(null)
        }
      })
      .finally(() => setLoading(false))
  }, [sessionId])

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
