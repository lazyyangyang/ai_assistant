import { authSession } from '@/lib/authSession'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { apiStreamChat } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { AgentType, ChatMessage, JDStructuredResult } from '@/types/chat'

let nextId = 1
function genId() {
  return `msg-${nextId++}`
}

interface UseStreamChatOptions {
  agentType: Exclude<AgentType, 'jd'> | null
  systemGreeting?: string
  sessionId?: string | null
  resumeId?: string | null
  jdContext?: JDStructuredResult | null
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
  onSessionChange,
}: UseStreamChatOptions) {
  const navigate = useNavigate()
  const location = useLocation()
  const [messages, setMessages] = useState<ChatMessage[]>(() => buildGreeting(systemGreeting))
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const operationSequence = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; abortRef.current?.abort() }
  }, [])

  const resetMessages = useCallback(() => {
    operationSequence.current++
    abortRef.current?.abort()
    setMessages(buildGreeting(systemGreeting))
  }, [systemGreeting])

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    setMessages(nextMessages)
  }, [])

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!agentType || !userText.trim() || isLoading || abortRef.current || !authSession.canRequest()) return
      const sequence = ++operationSequence.current
      const identity = authSession.captureIdentity()
      const current = () => mounted.current && sequence === operationSequence.current && authSession.isCurrent(identity)

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
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

      const commitAssistantContent = () => {
        if (!current()) return
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

        const res = await apiStreamChat({
          agent_type: agentType,
          messages: historyForApi,
          session_id: sessionId ?? undefined,
          resume_id: resumeId ?? undefined,
          jd_context: jdContext ?? undefined,
        }, controller.signal)

        if (!current()) { await res.data.cancel(); return }
        const returnedSessionId = res.headers['x-session-id']
        if (typeof returnedSessionId === 'string') {
          onSessionChange?.(returnedSessionId)
        }

        reader = res.data.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let eventType = 'token'

        while (true) {
          const { done, value } = await reader.read()
          if (!current()) { await reader.cancel(); return }
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
              if (raw.trim() === '[DONE]' || eventType === 'done') {
                await reader.cancel()
                if (assistantContent) commitAssistantContent()
                return
              }
              try {
                if (eventType === 'token') {
                  const parsed = JSON.parse(raw) as { content: string }
                  assistantContent += parsed.content

                  const now = performance.now()
                  if (!lastCommitAt || now - lastCommitAt >= THROTTLE_MS) {
                    commitAssistantContent()
                  }
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
        if (!current()) return
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
          navigate('/login', { replace: true, state: { from: location } })
          return
        }
        if (!controller.signal.aborted && !axios.isCancel(err) && (err as Error).name !== 'AbortError') {
          assistantContent =
            assistantContent || t('useStreamChat.requestFailure')
          commitAssistantContent()
        }
      } finally {
        if (reader) {
          try { await reader.cancel() } catch { /* Stream may already be closed. */ }
          reader.releaseLock()
        }
        if (controller.signal.aborted && assistantContent) commitAssistantContent()
        if (abortRef.current === controller) {
          if (mounted.current) setIsLoading(false)
          abortRef.current = null
        }
      }
    },
    [
      agentType,
      isLoading,
      location,
      messages,
      navigate,
      onSessionChange,
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
