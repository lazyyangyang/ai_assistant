import { useCallback, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AgentType, ChatMessage, JDStructuredResult } from '@/types/chat'

let nextId = 1
function genId() {
  return `msg-${nextId++}`
}

interface UseStreamChatOptions {
  agentType: AgentType
  systemGreeting?: string
  sessionId?: string | null
  resumeId?: string | null
  jdContext?: JDStructuredResult | null
  onStructuredData?: (data: JDStructuredResult) => void
  onSessionChange?: (sessionId: string) => void
}

function buildGreeting(systemGreeting?: string): ChatMessage[] {
  if (!systemGreeting) return []
  return [
    {
      id: genId(),
      role: 'assistant',
      content: systemGreeting,
      createdAt: Date.now(),
    },
  ]
}

export function useStreamChat({
  agentType,
  systemGreeting,
  sessionId,
  resumeId,
  jdContext,
  onStructuredData,
  onSessionChange,
}: UseStreamChatOptions) {
  const navigate = useNavigate()
  const location = useLocation()
  const [messages, setMessages] = useState<ChatMessage[]>(() => buildGreeting(systemGreeting))
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const resetMessages = useCallback(() => {
    setMessages(buildGreeting(systemGreeting))
  }, [systemGreeting])

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    setMessages(nextMessages)
  }, [])

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isLoading) return

      const userMsg: ChatMessage = {
        id: genId(),
        role: 'user',
        content: userText.trim(),
        createdAt: Date.now(),
      }

      const updatedMessages = [...messages, userMsg]
      setIsLoading(true)

      const assistantMsgId = genId()
      setMessages([
        ...updatedMessages,
        { id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now() },
      ])

      const controller = new AbortController()
      abortRef.current = controller

      const THROTTLE_MS = 30
      let assistantContent = ''
      let lastCommitAt = 0

      const commitAssistantContent = () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: assistantContent } : m,
          ),
        )
        lastCommitAt = performance.now()
      }

      try {
        const historyForApi = updatedMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => m.content !== systemGreeting)
          .map((m) => ({ role: m.role, content: m.content }))

        const token = localStorage.getItem('token')
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }

        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent_type: agentType,
            messages: historyForApi,
            session_id: sessionId ?? undefined,
            resume_id: resumeId ?? undefined,
            jd_context: jdContext ?? undefined,
          }),
          signal: controller.signal,
        })

        const returnedSessionId = res.headers.get('x-session-id')
        if (returnedSessionId) {
          onSessionChange?.(returnedSessionId)
        }

        if (res.status === 401) {
          localStorage.removeItem('token')
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
          navigate('/login', { replace: true, state: { from: location } })
          return
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No readable stream')

        const decoder = new TextDecoder()
        let buffer = ''
        let eventType = 'token'

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
              continue
            }
            if (line.startsWith('data: ')) {
              const raw = line.slice(6)
              if (raw === '[DONE]' || eventType === 'done') break
              try {
                if (eventType === 'token') {
                  const parsed = JSON.parse(raw) as { content: string }
                  assistantContent += parsed.content

                  const now = performance.now()
                  if (!lastCommitAt || now - lastCommitAt >= THROTTLE_MS) {
                    commitAssistantContent()
                  }
                }
                if (eventType === 'structured') {
                  const parsed = JSON.parse(raw) as JDStructuredResult
                  onStructuredData?.(parsed)
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
        }

        // Flush the remaining buffered content.
        if (assistantContent) {
          commitAssistantContent()
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          assistantContent =
            assistantContent || '抱歉，请求出错了，请稍后再试。'
          commitAssistantContent()
        }
      } finally {
        setIsLoading(false)
        abortRef.current = null
      }
    },
    [
      agentType,
      isLoading,
      location,
      messages,
      navigate,
      onSessionChange,
      onStructuredData,
      sessionId,
      resumeId,
      jdContext,
      systemGreeting,
    ],
  )

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setIsLoading(false)
  }, [])

  return {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    replaceMessages,
    resetMessages,
  }
}
