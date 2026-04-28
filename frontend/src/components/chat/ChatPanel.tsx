import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Square } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { apiGetChatSessionMessages, apiGetChatSessions, apiSynthesizeTts } from '@/lib/api'
import type { ChatSessionStatus, ChatSessionSummary, JDStructuredResult } from '@/types/chat'
import { useStreamChat } from '@/hooks/useStreamChat'
import { ChatInput } from './ChatInput'
import { ChatMessageBubble } from './ChatMessageBubble'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useToast } from '@/contexts/ToastContext'

interface Props {
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

export function ChatPanel({
  title,
  agentType,
  systemGreeting,
  selectedResumeId,
  selectedJdContext,
  onStructuredData,
  onLatestAssistantMessageChange,
  enableVoiceOutput = false,
  autoPlayVoiceOutput = true,
}: Props) {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const navigate = useNavigate()
  const latestSessionIdRef = useRef<string | null>(null)

  const handleSessionChange = useCallback((id: string) => {
    latestSessionIdRef.current = id
    setActiveSessionId(id)
  }, [])

  const { messages, isLoading, sendMessage, stopGeneration, replaceMessages, resetMessages } = useStreamChat({
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
          // Wait a tick so the <audio> element has the new `src`.
          window.setTimeout(() => {
            audioRef.current?.play().catch(() => {
              toast({
                title: '自动播放被浏览器限制',
                message: '请点击“播放语音”开始播放。',
                variant: 'info',
              })
            })
          }, 0)
        }
      } catch (err) {
        const msg = (err as Error).message || '语音合成失败'
        toast({ title: '语音合成失败', message: msg, variant: 'error' })
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
  const [input, setInput] = useState('')

  const viewportRef = useRef<HTMLDivElement | null>(null)

  const itemCount = useMemo(() => messages.length + (isLoading ? 1 : 0), [isLoading, messages.length])

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 140,
    overscan: 6,
  })

  useEffect(() => {
    if (itemCount <= 0) return
    // 始终跟随到底部（与之前逻辑保持一致）
    virtualizer.scrollToIndex(itemCount - 1)
  }, [itemCount, virtualizer])

  useEffect(() => {
    if (!onLatestAssistantMessageChange) return
    const lastAssistant = [...messages]
      .reverse()
      .find((msg) => msg.role === 'assistant' && msg.content.trim())
    onLatestAssistantMessageChange(lastAssistant?.content ?? '')
  }, [messages, onLatestAssistantMessageChange])

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId) ?? null, [sessions, activeSessionId])
  const isSessionCompleted = activeSession?.status === 'completed'

  const loadSessions = useCallback(async () => {
    const list = await apiGetChatSessions()
    setSessions(
      list
        .filter((s) => s.agent_type === agentType)
        .map((s) => ({
          id: s.id,
          agentType: s.agent_type,
          title: s.title,
          jdContent: s.jd_content,
          status: s.status as ChatSessionStatus,
          feedback: s.feedback ?? null,
          updatedAt: Date.parse(s.updated_at),
        })),
    )
  }, [agentType])

  useEffect(() => {
    apiGetChatSessions()
      .then((list) => {
        setSessions(
          list
            .filter((s) => s.agent_type === agentType)
            .map((s) => ({
              id: s.id,
              agentType: s.agent_type,
              title: s.title,
              jdContent: s.jd_content,
              status: s.status as ChatSessionStatus,
              feedback: s.feedback ?? null,
              updatedAt: Date.parse(s.updated_at),
            })),
        )
      })
      .catch(() => {})
  }, [agentType])

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
    await sendMessage('结束面试')
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
      toast({ title: '无法自动播放', message: '请重试或检查浏览器音频权限。', variant: 'info' })
    })
  }, [enableVoiceOutput, latestAssistantMessage, synthesizeVoiceForMessage, toast])

  return (
    <div className="flex h-[calc(100svh-8rem)] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <aside className="hidden w-64 shrink-0 border-r border-border md:flex md:flex-col">
        <div className="space-y-2 p-3">
          <Button className="w-full" variant="outline" onClick={handleNewChat}>
            新建对话
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1 px-2 py-2">
          <div className="space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                className={[
                  'w-full rounded-md px-3 py-2 text-left text-sm transition',
                  activeSessionId === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                ].join(' ')}
              >
                <p className="line-clamp-1 font-medium">{session.title || '新对话'}</p>
                <p className="mt-1 text-xs opacity-80">
                  {new Date(session.updatedAt).toLocaleString()}
                </p>
              </button>
            ))}
            {!sessions.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">暂无历史对话</p>
            )}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-base font-medium">{title}</h2>
        </div>
        <Separator />

        <ScrollArea className="min-h-0 flex-1 px-4 py-4" viewportRef={viewportRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index
              const msg = messages[index]
              const isLastLoadingRow = isLoading && index === messages.length

              return (
                <div
                  key={isLastLoadingRow ? 'loading' : msg.id}
                  ref={virtualizer.measureElement}
                  data-index={index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: 16,
                  }}
                >
                  {msg ? (
                    <ChatMessageBubble message={msg} />
                  ) : isLastLoadingRow ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex gap-0.5">
                        <span className="animate-bounce">·</span>
                        <span className="animate-bounce [animation-delay:0.15s]">·</span>
                        <span className="animate-bounce [animation-delay:0.3s]">·</span>
                      </span>
                      AI 正在思考
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex items-end gap-2 px-4 py-3">
          <div className="flex-1">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => {
                handleSend().catch(() => {})
              }}
              enableVoiceInput={agentType === 'interview'}
              disabled={isLoading || isSessionCompleted}
            />
          </div>

          {agentType === 'interview' && enableVoiceOutput && latestAssistantMessage ? (
            <div className="flex items-end gap-2">
              <audio ref={audioRef} src={ttsAudioUrl ?? undefined} preload="none" />
              <Button
                variant="outline"
                onClick={() => {
                  handlePlayVoice()
                }}
              disabled={isLoading || ttsIsGenerating || !latestAssistantMessage.content.trim()}
                className="shrink-0"
              >
                {ttsIsGenerating ? '生成语音…' : '播放语音'}
              </Button>
            </div>
          ) : null}

          {agentType === 'interview' && activeSessionId && !isSessionCompleted && (
            <Button
              variant="outline"
              onClick={() => {
                handleEndInterview().catch(() => {})
              }}
              disabled={isLoading}
              className="shrink-0"
            >
              结束面试
            </Button>
          )}
          {isLoading && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleStopGeneration}
              title="停止生成"
              className="shrink-0"
            >
              <Square className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
