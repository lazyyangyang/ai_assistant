import axios from 'axios'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import { useResumesData } from '@/hooks/useResumesData'
import { authSession } from '@/lib/authSession'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useToast } from '@/contexts/ToastContext'
import { useStreamChat } from '@/hooks/useStreamChat'
import { useJDRun } from '@/hooks/useJDRun'
import { rememberedJDSession, rememberJDSession } from '@/lib/jdRuns'
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
      resumeId: s.resume_id,
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
  const begin = useOperationGuard()
  const { resumes, loaded: resumesLoaded } = useResumesData()
  const [contextResumeId, setContextResumeId] = useState<string | null>(selectedResumeId ?? null)
  const [contextStarted, setContextStarted] = useState(false)
  const contextInvalid = agentType !== 'jd' && contextStarted && !!contextResumeId && resumesLoaded
    && !resumes.some(resume => resume.id === contextResumeId)
  const canSend = authSession.canRequest() && !contextInvalid
  const historySequence = useRef(0)
  const ttsSequence = useRef(0)
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => agentType === 'jd' ? rememberedJDSession() : null)
  const [input, setInput] = useState('')
  const navigate = useNavigate()
  const latestSessionIdRef = useRef<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const handleSessionChange = useCallback((id: string) => {
    latestSessionIdRef.current = id
    setActiveSessionId(id)
  }, [])

  const streamChat =
    useStreamChat({
      agentType: agentType === 'jd' ? null : agentType,
      systemGreeting,
      sessionId: activeSessionId,
      resumeId: contextStarted ? contextResumeId : selectedResumeId,
      jdContext: selectedJdContext,
      onSessionChange: handleSessionChange,
    })

  const isJDChat = agentType === 'jd'
  useEffect(() => { if (isJDChat) rememberJDSession(activeSessionId) }, [isJDChat, activeSessionId])
  const jdChat = useJDRun(isJDChat, activeSessionId, handleSessionChange, data => onStructuredData?.(data))
  const { messages, isLoading, sendMessage, stopGeneration, replaceMessages, resetMessages } = isJDChat ? jdChat : streamChat

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
    const stop = () => {
      ttsSequence.current++
      abortedRef.current = true
      clearTimeout(playbackTimer.current)
      audioRef.current?.pause()
      revokeTtsUrl()
      setTtsAudioUrl(null)
      setTtsIsGenerating(false)
    }
    const unsubscribe = authSession.subscribe(() => { if (!authSession.canRequest()) stop() })
    return () => { unsubscribe(); stop() }
  }, [revokeTtsUrl])

  const synthesizeVoiceForMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!enableVoiceOutput || !authSession.canRequest()) return
      if (!text.trim()) return
      if (ttsForMessageIdRef.current === messageId && ttsObjectUrlRef.current) return

      const operation = begin()
      const sequence = ++ttsSequence.current
      const current = () => operation.current() && sequence === ttsSequence.current
      setTtsIsGenerating(true)
      abortedRef.current = false

      try {
        audioRef.current?.pause()
        revokeTtsUrl()

        const blob = await apiSynthesizeTts(text, { signal: operation.signal })
        if (!current()) return
        const url = URL.createObjectURL(blob)
        ttsObjectUrlRef.current = url
        ttsForMessageIdRef.current = messageId
        setTtsAudioUrl(url)

        if (autoPlayVoiceOutput) {
          playbackTimer.current = setTimeout(() => {
            if (!current()) return
            audioRef.current?.play().catch(() => {
              if (!current()) return
              toast({
                title: t('ChatPanel.autoplayBlockedTitle'),
                message: t('ChatPanel.autoplayBlockedMessage'),
                variant: 'info',
              })
            })
          }, 0)
        }
      } catch (err) {
        if (!current() || axios.isCancel(err)) return
        const msg = (err as Error).message || t('ChatPanel.ttsFailureFallback')
        toast({ title: t('ChatPanel.ttsFailureTitle'), message: msg, variant: 'error' })
      } finally {
        if (current()) setTtsIsGenerating(false)
        operation.release()
      }
    },
    [autoPlayVoiceOutput, enableVoiceOutput, revokeTtsUrl, toast, begin],
  )

  useEffect(() => {
    if (!enableVoiceOutput) {
      prevIsLoadingRef.current = isLoading
      return
    }

    const prev = prevIsLoadingRef.current
    if (prev && !isLoading && authSession.canRequest()) {
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
    const operation = begin()
    try {
      const list = await apiGetChatSessions({ signal: operation.signal })
      if (operation.current()) setSessions(mapSessionSummaries(list, agentType))
    } finally { operation.release() }
  }, [agentType, begin])

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    if (isLoading) return
    if (!activeSessionId) {
      resetMessages()
      onStructuredData?.(null)
      return
    }

    const operation = begin()
    const sequence = ++historySequence.current
    apiGetChatSessionMessages(activeSessionId, { signal: operation.signal })
      .then((history) => {
        if (!operation.current() || sequence !== historySequence.current) return
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
      .finally(operation.release)

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
    return () => { historySequence.current = sequence + 1 }
  }, [activeSessionId, agentType, isLoading, onStructuredData, replaceMessages, resetMessages, sessions, begin])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !canSend) return
    if (!contextStarted) { setContextStarted(true); setContextResumeId(selectedResumeId ?? null) }
    setInput('')
    await sendMessage(text)
    loadSessions().catch(() => {})
  }, [input, loadSessions, sendMessage, canSend, contextStarted, selectedResumeId])

  const handleNewChat = useCallback(() => {
    if (!isJDChat) stopGeneration()
    historySequence.current++
    setContextResumeId(selectedResumeId ?? null)
    setContextStarted(false)
    setActiveSessionId(null)
    latestSessionIdRef.current = null
    resetMessages()
    onStructuredData?.(null)
  }, [onStructuredData, resetMessages, stopGeneration, selectedResumeId, isJDChat])

  const handleEndInterview = useCallback(async () => {
    if (isLoading || !canSend) return
    const operation = begin()
    if (isSessionCompleted) return
    setInput('')
    await sendMessage(t('ChatPanel.endInterview'))
    const sid = latestSessionIdRef.current
    if (sid && operation.current()) navigate(`/interview/end/${sid}`)
    operation.release()
  }, [isLoading, isSessionCompleted, navigate, sendMessage, canSend, begin])

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
    runStatus: isJDChat ? jdChat.runStatus : '',
    jdMode: isJDChat ? jdChat.mode : null,
    setJdMode: jdChat.setMode,
    sessions,
    activeSessionId,
    setActiveSessionId: (id: string) => {
      if (isJDChat) resetMessages()
      else stopGeneration()
      historySequence.current++
      setContextStarted(true)
      setContextResumeId(sessions.find(session => session.id === id)?.resumeId ?? null)
      latestSessionIdRef.current = id
      setActiveSessionId(id)
    },
    canSend,
    contextInvalid,
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
