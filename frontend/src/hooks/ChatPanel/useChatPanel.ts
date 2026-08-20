import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useToast } from '@/contexts/ToastContext'
import { apiSynthesizeTts } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useChatStore } from '@/stores/chatStore'
import type { AgentType, JDStructuredResult } from '@/types/chat'

export interface ChatPanelProps {
  title: string
  agentType: AgentType
  systemGreeting?: string
  selectedResumeId?: string | null
  selectedJdContext?: JDStructuredResult | null
  enableVoiceOutput?: boolean
  autoPlayVoiceOutput?: boolean
}

export function useChatPanel({
  agentType,
  systemGreeting,
  selectedResumeId,
  selectedJdContext,
  enableVoiceOutput = false,
  autoPlayVoiceOutput = true,
}: ChatPanelProps) {
  // 会话和消息属于跨页面聊天领域状态；输入、音频元素和虚拟列表只服务当前面板，继续局部管理。
  const { toast } = useToast()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const sessions = useChatStore((state) => state.sessionsByAgent[agentType])
  const activeSessionId = useChatStore(
    (state) => state.activeSessionIdByAgent[agentType],
  )
  const messages = useChatStore((state) => state.messagesByAgent[agentType])
  const isLoading = useChatStore((state) => state.streamingByAgent[agentType])
  const initializeAgent = useChatStore((state) => state.initializeAgent)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const selectSession = useChatStore((state) => state.selectSession)
  const createNewChat = useChatStore((state) => state.createNewChat)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopGeneration = useChatStore((state) => state.stopGeneration)

  useEffect(() => {
    initializeAgent(agentType, systemGreeting)
    loadSessions(agentType).catch(() => {})
  }, [agentType, initializeAgent, loadSessions, systemGreeting])

  const latestAssistantMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'assistant' && message.content.trim()) return message
    }
    return null
  }, [messages])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null)
  const [ttsIsGenerating, setTtsIsGenerating] = useState(false)
  // 音频 URL 与 DOM 引用不可序列化，也没有跨页面共享价值，因此不进入 Zustand。
  const ttsForMessageIdRef = useRef<string | null>(null)
  const ttsObjectUrlRef = useRef<string | null>(null)
  const previousIsLoadingRef = useRef(isLoading)
  const stoppedByUserRef = useRef(false)

  const revokeTtsUrl = useCallback(() => {
    const url = ttsObjectUrlRef.current
    if (url) {
      URL.revokeObjectURL(url)
      ttsObjectUrlRef.current = null
    }
  }, [])

  useEffect(() => revokeTtsUrl, [revokeTtsUrl])

  const synthesizeVoiceForMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!enableVoiceOutput || !text.trim()) return
      if (ttsForMessageIdRef.current === messageId && ttsObjectUrlRef.current) return

      setTtsIsGenerating(true)
      stoppedByUserRef.current = false

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
      } catch (error) {
        const message = (error as Error).message || t('ChatPanel.ttsFailureFallback')
        toast({ title: t('ChatPanel.ttsFailureTitle'), message, variant: 'error' })
      } finally {
        setTtsIsGenerating(false)
      }
    },
    [autoPlayVoiceOutput, enableVoiceOutput, revokeTtsUrl, toast],
  )

  useEffect(() => {
    if (!enableVoiceOutput) {
      previousIsLoadingRef.current = isLoading
      return
    }

    // 只在 streaming: true -> false 的边沿自动播报，避免普通消息重渲染重复触发 TTS。
    const wasLoading = previousIsLoadingRef.current
    if (wasLoading && !isLoading) {
      if (stoppedByUserRef.current) {
        stoppedByUserRef.current = false
      } else if (latestAssistantMessage?.content.trim()) {
        void synthesizeVoiceForMessage(
          latestAssistantMessage.id,
          latestAssistantMessage.content,
        )
      }
    }
    previousIsLoadingRef.current = isLoading
  }, [enableVoiceOutput, isLoading, latestAssistantMessage, synthesizeVoiceForMessage])

  const itemCount = messages.length + (isLoading ? 1 : 0)
  // 虚拟列表是纯视图优化，按当前可见消息计算，不污染可复用的聊天业务 Store。
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 140,
    overscan: 6,
  })

  useEffect(() => {
    if (itemCount > 0) virtualizer.scrollToIndex(itemCount - 1)
  }, [itemCount, virtualizer])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  )
  const isSessionCompleted = activeSession?.status === 'completed'

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectSession(agentType, sessionId).catch(() => {})
    },
    [agentType, selectSession],
  )

  const handleSend = useCallback(async () => {
    const content = input.trim()
    if (!content) return
    setInput('')
    await sendMessage({
      agentType,
      content,
      resumeId: selectedResumeId,
      jdContext: selectedJdContext,
    })
  }, [agentType, input, selectedJdContext, selectedResumeId, sendMessage])

  const handleNewChat = useCallback(() => {
    createNewChat(agentType)
  }, [agentType, createNewChat])

  const handleEndInterview = useCallback(async () => {
    if (isLoading || isSessionCompleted) return
    setInput('')
    await sendMessage({
      agentType,
      content: t('ChatPanel.endInterview'),
      resumeId: selectedResumeId,
      jdContext: selectedJdContext,
    })
    // sendMessage 期间新会话 ID 才会从响应头写入 Store，完成后读取最新值再导航结束页。
    const sessionId = useChatStore.getState().activeSessionIdByAgent[agentType]
    if (sessionId) navigate(`/interview/end/${sessionId}`)
  }, [
    agentType,
    isLoading,
    isSessionCompleted,
    navigate,
    selectedJdContext,
    selectedResumeId,
    sendMessage,
  ])

  const handleStopGeneration = useCallback(() => {
    stoppedByUserRef.current = true
    stopGeneration(agentType)
  }, [agentType, stopGeneration])

  const handlePlayVoice = useCallback(() => {
    if (!enableVoiceOutput || !latestAssistantMessage?.content.trim()) return

    if (
      ttsForMessageIdRef.current !== latestAssistantMessage.id
      || !ttsObjectUrlRef.current
    ) {
      void synthesizeVoiceForMessage(
        latestAssistantMessage.id,
        latestAssistantMessage.content,
      )
      return
    }
    audioRef.current?.play().catch(() => {
      toast({
        title: t('ChatPanel.playFailureTitle'),
        message: t('ChatPanel.playFailureMessage'),
        variant: 'info',
      })
    })
  }, [enableVoiceOutput, latestAssistantMessage, synthesizeVoiceForMessage, toast])

  return {
    sessions,
    activeSessionId,
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
    handleSelectSession,
    handleSend,
    handleNewChat,
    handleEndInterview,
    handleStopGeneration,
    handlePlayVoice,
  }
}
