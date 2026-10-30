import { useCallback, useEffect, useRef, useState } from 'react'
import { authSession } from '@/lib/authSession'
import { apiGetChatSessionMessages } from '@/lib/api'
import { cancelJDRun, getLatestJDRun, observeJDRun, getSucceededJDResult, submitJDRun, type JDRun } from '@/lib/jdRuns'
import type { ChatMessage, JDStructuredResult } from '@/types/chat'

export function useJDRun(enabled: boolean, sessionId: string | null,
  onSession: (id: string) => void, onStructured?: (data: JDStructuredResult) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setLoading] = useState(false)
  const [runStatus, setStatus] = useState('')
  const [mode, setMode] = useState<'followup' | 'update'>('followup')
  const [observationVersion, setObservationVersion] = useState(0)
  const observerControllerRef = useRef<AbortController | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const callbacksRef = useRef({ onSession, onStructured })
  useEffect(() => { callbacksRef.current = { onSession, onStructured } })

  const observe = useCallback(async (run: JDRun, abortController: AbortController) => {
    const identity = authSession.captureIdentity()
    const isObservationCurrent = () => !abortController.signal.aborted && authSession.isCurrent(identity)
    activeRunIdRef.current = run.id
    const history = await apiGetChatSessionMessages(run.session_id, { signal: abortController.signal })
    if (!isObservationCurrent()) return
    setMessages(history.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: Date.parse(m.created_at) })))
    const assistantId = run.assistant_message_id
    await observeJDRun(run.id, abortController.signal, state => {
      if (!isObservationCurrent()) return
      setMessages(previous => previous.map(m => m.id === assistantId ? { ...m, content: state.result_text } : m))
      setStatus(state.cancel_requested && state.status === 'running' ? '取消中' :
        ({ queued: '等待执行', running: state.phase === 'structured' ? '提取结构化结果' : '正在分析',
          succeeded: '已完成', cancelled: '已取消', interrupted: '已中断，可重新生成',
          failed: state.phase === 'structured' ? '分析已完成，结构化提取失败' : '生成失败，可重新生成' }[state.status] ?? state.status))
      const structured = getSucceededJDResult(state)
      if (structured) callbacksRef.current.onStructured?.(structured)
    })
  }, [])

  useEffect(() => {
    if (!enabled || !sessionId || observerControllerRef.current) return
    const abortController = new AbortController()
    observerControllerRef.current = abortController
    setLoading(true)
    getLatestJDRun(sessionId, abortController.signal).then(run => run && observe(run, abortController))
      .catch(() => { if (!abortController.signal.aborted) setStatus('连接中断，请重新选择会话恢复') })
      .finally(() => { if (observerControllerRef.current === abortController) { observerControllerRef.current = null; setLoading(false) } })
    // Session changes detach the observer; the server task continues.
    return () => { abortController.abort(); if (observerControllerRef.current === abortController) observerControllerRef.current = null }
  }, [enabled, sessionId, observe, observationVersion])

  useEffect(() => {
    const identity = enabled && authSession.canRequest() ? authSession.captureIdentity() : null
    const unsubscribe = authSession.subscribe(() => {
      if (identity && !authSession.isCurrent(identity)) {
        observerControllerRef.current?.abort()
        setMessages([])
        setStatus('')
      }
    })
    return () => { unsubscribe(); observerControllerRef.current?.abort() }
  }, [enabled])

  const sendMessage = async (content: string) => {
    if (observerControllerRef.current || !content.trim() || !authSession.canRequest()) return
    const identity = authSession.captureIdentity()
    const abortController = new AbortController()
    observerControllerRef.current = abortController
    setLoading(true)
    setStatus('提交中')
    const request = { client_request_id: crypto.randomUUID(), content, session_id: sessionId ?? undefined, mode: sessionId ? mode : 'new' as const }
    try {
      let run: JDRun
      try { run = await submitJDRun(request, abortController.signal) }
      catch (error) {
        if (abortController.signal.aborted) throw error
        run = await submitJDRun(request, abortController.signal)
      }
      if (!authSession.isCurrent(identity) || abortController.signal.aborted) return
      callbacksRef.current.onSession(run.session_id)
      await observe(run, abortController)
    } catch {
      if (!abortController.signal.aborted && authSession.isCurrent(identity)) setStatus('请求未完成，请选择会话查看状态')
    } finally {
      if (observerControllerRef.current === abortController) { observerControllerRef.current = null; setLoading(false) }
    }
  }
  const stopGeneration = async () => {
    if (!activeRunIdRef.current || !authSession.canRequest()) return
    const identity = authSession.captureIdentity()
    setStatus('取消中')
    try { await cancelJDRun(activeRunIdRef.current) }
    catch { if (authSession.isCurrent(identity)) setStatus('取消未确认，请重试') }
  }
  const resetMessages = useCallback(() => {
    observerControllerRef.current?.abort()
    observerControllerRef.current = null
    activeRunIdRef.current = null
    setLoading(false)
    setMessages([])
    setStatus('')
    setObservationVersion(value => value + 1)
  }, [])
  return { messages, isLoading, sendMessage, stopGeneration, replaceMessages: setMessages, resetMessages, runStatus, mode, setMode }
}
