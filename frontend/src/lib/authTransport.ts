import axios from 'axios'
import type { AuthTransport, TokenResponse } from './authTypes'
import { normalizeHttpError } from './httpErrors'
export function authSessionUrl(sid: string, action: 'refresh' | 'logout') {
  if (!/^[0-9a-f]{32}$/.test(sid)) throw new Error('无效的认证会话 ID')
  return `/auth/sessions/${sid}/${action}`
}
export const publicHttp = axios.create({ baseURL: '/api', adapter: 'fetch', withCredentials: true,
  timeout: 10_000, headers: { 'X-CSRF-Protection': '1' } })
publicHttp.interceptors.response.use(undefined, normalizeHttpError)
export const authTransport: AuthTransport = {
  login: async (input, signal) => (await publicHttp.post<TokenResponse>('/auth/login', input, { signal })).data,
  refresh: async (sid, signal) => (await publicHttp.post<TokenResponse>(authSessionUrl(sid, 'refresh'), null, { signal })).data,
  logout: async (sid, signal) => { await publicHttp.post(authSessionUrl(sid, 'logout'), null, { signal }) },
}
