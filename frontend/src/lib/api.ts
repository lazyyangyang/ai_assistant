import type { AxiosRequestConfig } from 'axios'
import { http } from './http'
import { authSession } from './authSession'

import { publicHttp } from './authTransport'
import { publishResumeChange } from './businessEvents'
export type { TokenResponse } from './authTypes'
type RequestOptions = { signal?: AbortSignal }

async function request<T>(path: string, options: AxiosRequestConfig = {}): Promise<T> {
  const identity = authSession.captureIdentity()
  const response = await http.request<T>({ ...options, url: path, identity } as AxiosRequestConfig)
  return response.status === 204 ? undefined as T : response.data
}

export interface UserInfo {
  id: string
  username: string
  email: string
}

export type AgentType = 'jd' | 'resume' | 'interview'

export interface ChatSessionDTO {
  id: string
  agent_type: AgentType
  title: string
  status: string
  resume_id?: string | null
  jd_content?: string | null
  feedback?: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessageDTO {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  updated_at: string
}

export interface ResumeDTO {
  id: string
  version: number
  title: string
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function apiRegister(username: string, email: string, password: string) {
  return (await publicHttp.post<UserInfo>('/auth/register', { username, email, password })).data
}

export function apiLogin(email: string, password: string) {
  return authSession.login({ email, password })
}
export function apiLogout() { return authSession.logout() }
export async function apiGetMe(options: RequestOptions = {}) {
  return request<UserInfo>('/auth/me', { ...options, timeout: 10_000, internalIdentityRead: true } as AxiosRequestConfig)
}

export async function apiGetChatSessions(options: RequestOptions = {}) {
  return request<ChatSessionDTO[]>('/chat/sessions', options)
}

export async function apiGetChatSessionMessages(sessionId: string, options: RequestOptions = {}) {
  return request<ChatMessageDTO[]>(`/chat/sessions/${sessionId}/messages`, options)
}

export async function apiUploadResume(file: File, title?: string, options: RequestOptions = {}) {
  const formData = new FormData()
  formData.append('file', file)
  if (title?.trim()) {
    formData.append('title', title.trim())
  }
  return resumeWrite<ResumeDTO>('/resumes/upload', {
    ...options,
    method: 'POST',
    data: formData,
  })
}

export async function apiGetResumes(options: RequestOptions = {}) {
  return request<ResumeDTO[]>('/resumes', options)
}

export async function apiGetResume(resumeId: string, options: RequestOptions = {}) {
  return request<ResumeDTO>(`/resumes/${resumeId}`, options)
}

export async function apiDeleteResume(resumeId: string, options: RequestOptions = {}) {
  return resumeWrite<void>(`/resumes/${resumeId}`, { ...options, method: 'DELETE' })
}

export async function apiUpdateResume(
  resumeId: string,
  body: { title?: string; is_active?: boolean },
  options: RequestOptions = {},
) {
  return resumeWrite<ResumeDTO>(`/resumes/${resumeId}`, {
    ...options,
    method: 'PATCH',
    data: body,
  })
}

export async function apiCreateResumeVersion(body: {
  title: string
  content: string
  is_active?: boolean
}, options: RequestOptions = {}) {
  return resumeWrite<ResumeDTO>('/resumes', {
    ...options,
    method: 'POST',
    data: body,
  })
}

export interface TranscribeResponse {
  text: string
}

export async function apiTranscribeAudio(audio: Blob | File, language?: string, options: RequestOptions = {}) {
  const formData = new FormData()
  let filename: string
  if (audio instanceof File) {
    filename = audio.name
  } else {
    // Blob names have no extension, so infer one from the MIME type for backend handling.
    const t = audio.type || ''
    if (t.includes('ogg')) filename = 'audio.ogg'
    else if (t.includes('webm')) filename = 'audio.webm'
    else filename = 'audio.webm'
  }
  formData.append('file', audio, filename)
  if (language?.trim()) {
    formData.append('language', language.trim())
  }

  return request<TranscribeResponse>('/stt/transcribe', {
    ...options,
    method: 'POST',
    data: formData,
  })
}

export async function apiSynthesizeTts(text: string, options: RequestOptions = {}) {
  return request<Blob>('/tts/synthesize', {
    ...options,
    method: 'POST',
    data: { text },
    responseType: 'blob',
  })
}

export function apiStreamChat(data: {
  agent_type: AgentType
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  session_id?: string
  resume_id?: string
  jd_context?: import('@/types/chat').JDStructuredResult
}, signal: AbortSignal) {
  const identity = authSession.captureIdentity()
  return http.post<ReadableStream<Uint8Array>>('/chat/stream', data, {
    identity,
    responseType: 'stream',
    signal,
  } as AxiosRequestConfig)
}

async function resumeWrite<T>(path: string, options: AxiosRequestConfig): Promise<T> {
  const identity = authSession.captureIdentity()
  const result = await request<T>(path, options)
  if (authSession.isCurrent(identity)) {
    try { publishResumeChange(identity) } catch { /* Notification cannot reverse a committed write. */ }
  }
  return result
}
