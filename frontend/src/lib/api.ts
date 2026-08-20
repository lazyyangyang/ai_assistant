const BASE = '/api'

// Access Token 只驻留内存，降低脚本可长期读取凭证的风险；页面恢复依赖 HttpOnly Refresh Cookie。
let accessToken: string | null = null
// 多个接口可能同时收到 401，共享同一个 Promise 可避免并发刷新造成 token 风暴。
let refreshPromise: Promise<boolean> | null = null
// API 层不应依赖 React Router/Context，通过回调把不可恢复的鉴权失败交给应用层处理。
let authFailureHandler: (() => void) | null = null

export function setAccessToken(token: string) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken() {
  accessToken = null
}

export function setAuthFailureHandler(handler: (() => void) | null) {
  authFailureHandler = handler
}

function buildHeaders(options: RequestInit) {
  const headers = new Headers(options.headers)
  // 浏览器必须自行生成 multipart boundary，因此 FormData 请求不能强制写 JSON Content-Type。
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return headers
}

export async function apiRefreshAccessToken(): Promise<boolean> {
  // 刷新凭证由浏览器自动携带，JavaScript 从始至终无法读取 HttpOnly Cookie。
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        clearAccessToken()
        return false
      }

      const body = (await res.json()) as TokenResponse
      if (!body.access_token) {
        clearAccessToken()
        return false
      }
      setAccessToken(body.access_token)
      return true
    } catch {
      clearAccessToken()
      return false
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  retryUnauthorized = true,
  notifyOnUnauthorized = true,
): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include',
  })

  // 每个请求最多重放一次，防止 refresh 成功但权限仍不足时陷入无限 401 循环。
  if (res.status !== 401 || !retryUnauthorized) {
    if (res.status === 401 && notifyOnUnauthorized) authFailureHandler?.()
    return res
  }

  const refreshed = await apiRefreshAccessToken()
  if (!refreshed) {
    if (notifyOnUnauthorized) authFailureHandler?.()
    return res
  }

  return authenticatedFetch(path, options, false, notifyOnUnauthorized)
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryUnauthorized = true,
  notifyOnUnauthorized = true,
): Promise<T> {
  // JSON API 统一走这里，确保鉴权续期、错误提取和 204 处理在所有页面保持一致。
  const res = await authenticatedFetch(
    path,
    options,
    retryUnauthorized,
    notifyOnUnauthorized,
  )

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
  status: 'generating' | 'completed' | 'failed' | 'stopped'
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
  }, false, false)
}

export async function apiLogin(email: string, password: string) {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false, false)
}

export async function apiLogout() {
  clearAccessToken()
  await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
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

export async function apiStopChatSession(sessionId: string) {
  return request<void>(`/chat/sessions/${sessionId}/stop`, { method: 'POST' })
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
  const res = await authenticatedFetch('/tts/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }

  return res.blob()
}
