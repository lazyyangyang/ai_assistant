import { http } from './http'
import { authSession } from './authSession'
import type { JDStructuredResult } from '@/types/chat'

export interface JDRun {
  id: string
  session_id: string
  status: string
  phase: string
  result_text: string
  structured_json: string | null
  error_code: string | null
  cancel_requested: boolean
  assistant_message_id: string
}
export interface JDRunRequest {
  client_request_id: string
  session_id?: string
  content: string
  mode: 'new' | 'followup' | 'update'
}
function getJDSessionStorageKey() {
  return `jd-run-session:${authSession.captureIdentity().sessionId}`
}
export function rememberedJDSession(): string | null {
  try { return sessionStorage.getItem(getJDSessionStorageKey()) } catch { return null }
}
export function rememberJDSession(id: string | null) {
  try {
    if (id) sessionStorage.setItem(getJDSessionStorageKey(), id)
    else sessionStorage.removeItem(getJDSessionStorageKey())
  } catch { /* Storage unavailable: in-page use still works. */ }
}
export const submitJDRun = async (input: JDRunRequest, signal: AbortSignal) =>
  (await http.post<JDRun>('/chat/runs', input, { signal })).data
export const getJDRun = async (id: string, signal: AbortSignal) =>
  (await http.get<JDRun>(`/chat/runs/${id}`, { signal })).data
export const getLatestJDRun = async (session: string, signal: AbortSignal) =>
  (await http.get<JDRun[]>('/chat/runs', { params: { session_id: session }, signal })).data[0]
export const cancelJDRun = async (id: string) => (await http.post<JDRun>(`/chat/runs/${id}/cancel`)).data

export async function observeJDRun(id: string, signal: AbortSignal, apply: (run: JDRun) => void) {
  const identity = authSession.captureIdentity()
  const current = () => !signal.aborted && authSession.isCurrent(identity)
  // 重连只恢复观察；生成由持久化任务负责，不能在这里重新提交。
  let cursor = '0-0'
  let state = await getJDRun(id, signal)
  while (current()) {
    apply(state)
    if (!['queued', 'running'].includes(state.status)) return state
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await http.get<ReadableStream<Uint8Array>>(`/chat/runs/${id}/events`, {
        params: { after: cursor }, signal, responseType: 'stream', timeout: 0,
      })
      reader = response.data.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (current()) {
        const part = await reader.read()
        if (part.done) break
        buffer += decoder.decode(part.value, { stream: true }).replace(/\r/g, '')
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const lines = block.split('\n')
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
          const eventId = lines.find(line => line.startsWith('id:'))?.slice(3).trim()
          const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!raw) continue
          const data = JSON.parse(raw)
          if (eventId && event !== 'snapshot') {
            const [eventMilliseconds, eventSequence] = eventId.split('-').map(BigInt)
            const [cursorMilliseconds, cursorSequence] = cursor.split('-').map(BigInt)
            if (eventMilliseconds < cursorMilliseconds || (eventMilliseconds === cursorMilliseconds && eventSequence <= cursorSequence)) continue
          }
          if (event === 'snapshot') state = data as JDRun
          else if (event === 'token') state = { ...state, result_text: state.result_text + data.content }
          else if (event === 'status') state = { ...state, phase: data.phase }
          else if (['completed', 'failed', 'cancelled', 'interrupted', 'auth_expired', 'unavailable'].includes(event ?? '')) {
            await reader.cancel()
            break
          }
          if (eventId) cursor = eventId
          apply(state)
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
    } finally {
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    // Only durable status confirms success; reconnect never resubmits a generation.
    while (current()) {
      try { state = await getJDRun(id, signal); break }
      catch (error) {
        if (!current()) throw error
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }
  return state
}

export function getSucceededJDResult(run: JDRun): JDStructuredResult | null {
  return run.status === 'succeeded' && run.structured_json ? JSON.parse(run.structured_json) : null
}
