import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useToast } from '@/contexts/ToastContext'
import { useStreamChat } from '@/hooks/useStreamChat'
import { apiGetChatSessionMessages, apiGetChatSessions, apiSynthesizeTts } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { ChatSessionStatus, ChatSessionSummary, JDStructuredResult } from '@/types/chat'

export interface ChatPanelProps {
  title: string
  agentType: 'jd' | 'resume' | 'interview'
  systemGreeting?: string
  selectedResumeId?: string | null
  selectedJdContext?: JDStructuredResult | null
  onStructuredData?: (data: JDStructuredResult | null) => void
  onLatestAssistantMessageChange?: (content: string) => void
  enableVoiceOutput?: boolean
  autoPlayVoiceOutput?: boolean
}

function mapSessionSummaries(
  list: Awaited<ReturnType<typeof apiGetChatSessions>>,
  agentType: ChatPanelProps['agentType'],
) {
  return list
    .filter((s) => s.agent_type === agentType)
    .map((s) => ({
      id: s.id,
      agentType: s.agent_type,
      title: s.title,
      jdContent: s.jd_content,
      status: s.status as ChatSessionStatus,
      feedback: s.feedback ?? null,
      updatedAt: Date.parse(s.updated_at),
    }))
}

export function useChatPanel({
  agentType,
  systemGreeting,
  selectedResumeId,
  selectedJdContext,
  onStructuredData,
  onLatestAssistantMessageChange,
  enableVoiceOutput = false,
  autoPlayVoiceOutput = true,
}: ChatPanelProps) {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const navigate = useNavigate()
  const latestSessionIdRef = useRef<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const handleSessionChange = useCallback((id: string) => {
    latestSessionIdRef.current = id
    setActiveSessionId(id)
  }, [])

  const { messages, isLoading, sendMessage, stopGeneration, replaceMessages, resetMessages } =
    useStreamChat({
      agentType,
      systemGreeting,
      sessionId: activeSessionId,
      resumeId: selectedResumeId,
      jdContext: selectedJdContext,
      onStructuredData: (data) => onStructuredData?.(data),
      onSessionChange: handleSessionChange,
    })

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.content.trim()) return msg
    }
    return null
  }, [messages])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null)
  const [ttsIsGenerating, setTtsIsGenerating] = useState(false)
  const ttsForMessageIdRef = useRef<string | null>(null)
  const ttsObjectUrlRef = useRef<string | null>(null)
  const prevIsLoadingRef = useRef(isLoading)
  const abortedRef = useRef(false)

  const revokeTtsUrl = useCallback(() => {
    const url = ttsObjectUrlRef.current
    if (url) {
      URL.revokeObjectURL(url)
      ttsObjectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      revokeTtsUrl()
    }
  }, [revokeTtsUrl])

  const synthesizeVoiceForMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!enableVoiceOutput) return
      if (!text.trim()) return
      if (ttsForMessageIdRef.current === messageId && ttsObjectUrlRef.current) return

      setTtsIsGenerating(true)
      abortedRef.current = false

      try {
        audioRef.current?.pause()
        revokeTtsUrl()

        const blob = await apiSynthesizeTts(text)
        const url = URL.createObjectURL(blob)
        ttsObjectUrlRef.current = url
        ttsForMessageIdRef.current = messageId
        setTtsAudioUrl(url)

        if (autoPlayVoiceOutput) {
          window.setTimeout(() => {
            audioRef.current?.play().catch(() => {
              toast({
                title: t('ChatPanel.autoplayBlockedTitle'),
                message: t('ChatPanel.autoplayBlockedMessage'),
                variant: 'info',
              })
            })
          }, 0)
        }
      } catch (err) {
        const msg = (err as Error).message || t('ChatPanel.ttsFailureFallback')
        toast({ title: t('ChatPanel.ttsFailureTitle'), message: msg, variant: 'error' })
      } finally {
        setTtsIsGenerating(false)
      }
    },
    [autoPlayVoiceOutput, enableVoiceOutput, revokeTtsUrl, toast],
  )

  useEffect(() => {
    if (!enableVoiceOutput) {
      prevIsLoadingRef.current = isLoading
      return
    }

    const prev = prevIsLoadingRef.current
    if (prev && !isLoading) {
      if (abortedRef.current) {
        abortedRef.current = false
        prevIsLoadingRef.current = isLoading
        return
      }

      if (latestAssistantMessage && latestAssistantMessage.content.trim()) {
        void synthesizeVoiceForMessage(latestAssistantMessage.id, latestAssistantMessage.content)
      }
    }
    prevIsLoadingRef.current = isLoading
  }, [enableVoiceOutput, isLoading, latestAssistantMessage, synthesizeVoiceForMessage])

  const itemCount = useMemo(
    () => messages.length + (isLoading ? 1 : 0),
    [isLoading, messages.length],
  )

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 140,
    overscan: 6,
  })

  useEffect(() => {
    if (itemCount <= 0) return
    virtualizer.scrollToIndex(itemCount - 1)
  }, [itemCount, virtualizer])

  useEffect(() => {
    if (!onLatestAssistantMessageChange) return
    const lastAssistant = [...messages]
      .reverse()
      .find((msg) => msg.role === 'assistant' && msg.content.trim())
    onLatestAssistantMessageChange(lastAssistant?.content ?? '')
  }, [messages, onLatestAssistantMessageChange])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )
  const isSessionCompleted = activeSession?.status === 'completed'

  const loadSessions = useCallback(async () => {
    const list = await apiGetChatSessions()
    setSessions(mapSessionSummaries(list, agentType))
  }, [agentType])

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    if (!activeSessionId) {
      resetMessages()
      onStructuredData?.(null)
      return
    }
    if (isLoading) return

    apiGetChatSessionMessages(activeSessionId)
      .then((history) => {
        replaceMessages(
          history.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: Date.parse(msg.created_at),
          })),
        )
      })
      .catch(() => {})

    if (agentType === 'jd') {
      const selected = sessions.find((item) => item.id === activeSessionId)
      if (selected?.jdContent) {
        try {
          onStructuredData?.(JSON.parse(selected.jdContent) as JDStructuredResult)
        } catch {
          onStructuredData?.(null)
        }
      } else {
        onStructuredData?.(null)
      }
    }
  }, [activeSessionId, agentType, isLoading, onStructuredData, replaceMessages, resetMessages, sessions])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
    loadSessions().catch(() => {})
  }, [input, loadSessions, sendMessage])

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null)
    resetMessages()
    onStructuredData?.(null)
  }, [onStructuredData, resetMessages])

  const handleEndInterview = useCallback(async () => {
    if (isLoading) return
    if (isSessionCompleted) return
    setInput('')
    await sendMessage(t('ChatPanel.endInterview'))
    const sid = latestSessionIdRef.current
    if (sid) navigate(`/interview/end/${sid}`)
  }, [isLoading, isSessionCompleted, navigate, sendMessage])

  const handleStopGeneration = useCallback(() => {
    abortedRef.current = true
    stopGeneration()
  }, [stopGeneration])

  const handlePlayVoice = useCallback(() => {
    if (!enableVoiceOutput) return
    if (!latestAssistantMessage) return
    if (!latestAssistantMessage.content.trim()) return

    if (ttsForMessageIdRef.current !== latestAssistantMessage.id || !ttsObjectUrlRef.current) {
      void synthesizeVoiceForMessage(latestAssistantMessage.id, latestAssistantMessage.content)
      return
    }
    audioRef.current?.play().catch(() => {
      toast({ title: t('ChatPanel.playFailureTitle'), message: t('ChatPanel.playFailureMessage'), variant: 'info' })
    })
  }, [enableVoiceOutput, latestAssistantMessage, synthesizeVoiceForMessage, toast])

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    messages,
    isLoading,
    input,
    setInput,
    latestAssistantMessage,
    audioRef,
    ttsAudioUrl,
    ttsIsGenerating,
    viewportRef,
    virtualizer,
    isSessionCompleted,
    handleSend,
    handleNewChat,
    handleEndInterview,
    handleStopGeneration,
    handlePlayVoice,
  }
}
