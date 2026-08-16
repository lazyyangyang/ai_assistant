const BASE = '/api'

let accessToken: string | null = null

export function setAccessToken(token: string) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken() {
  accessToken = null
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export interface TokenResponse {
  access_token: string
  token_type: string
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
  return request<TokenResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  })
}

export async function apiLogin(email: string, password: string) {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function apiGetMe() {
  return request<UserInfo>('/auth/me')
}

export async function apiGetChatSessions() {
  return request<ChatSessionDTO[]>('/chat/sessions')
}

export async function apiGetChatSessionMessages(sessionId: string) {
  return request<ChatMessageDTO[]>(`/chat/sessions/${sessionId}/messages`)
}

export async function apiUploadResume(file: File, title?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (title?.trim()) {
    formData.append('title', title.trim())
  }
  return request<ResumeDTO>('/resumes/upload', {
    method: 'POST',
    body: formData,
  })
}

export async function apiGetResumes() {
  return request<ResumeDTO[]>('/resumes')
}

export async function apiGetResume(resumeId: string) {
  return request<ResumeDTO>(`/resumes/${resumeId}`)
}

export async function apiDeleteResume(resumeId: string) {
  return request<void>(`/resumes/${resumeId}`, { method: 'DELETE' })
}

export async function apiUpdateResume(
  resumeId: string,
  body: { title?: string; is_active?: boolean },
) {
  return request<ResumeDTO>(`/resumes/${resumeId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function apiCreateResumeVersion(body: {
  title: string
  content: string
  is_active?: boolean
}) {
  return request<ResumeDTO>('/resumes', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface TranscribeResponse {
  text: string
}

export async function apiTranscribeAudio(audio: Blob | File, language?: string) {
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
    method: 'POST',
    body: formData,
  })
}

export async function apiSynthesizeTts(text: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAccessToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}/tts/synthesize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }

  return res.blob()
}
