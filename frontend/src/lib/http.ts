import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { authSession } from './authSession'
import type { IdentitySnapshot } from './authTypes'
import { normalizeHttpError } from './httpErrors'
import { createRequestScope } from './requestScope'

interface ScopedConfig extends InternalAxiosRequestConfig {
  identity?: IdentitySnapshot
  authRetried?: boolean
  internalIdentityRead?: boolean
  scope?: ReturnType<typeof createRequestScope>
}
export const http = axios.create({ baseURL: '/api', adapter: 'fetch', withCredentials: true })
const allowed = (config: ScopedConfig) => authSession.canRequest(config.internalIdentityRead === true && config.url === '/auth/me')
function check(config: ScopedConfig) {
  if (!config.identity || !authSession.isCurrent(config.identity) || !allowed(config) || config.signal?.aborted) {
    throw new axios.CanceledError('登录状态已改变，请重新操作')
  }
}
http.interceptors.request.use(async (base) => {
  const config = base as ScopedConfig
  config.identity ??= authSession.captureIdentity()
  try {
    check(config)
    config.scope ??= createRequestScope(config.signal as AbortSignal | undefined)
    config.signal = config.scope.signal
    await authSession.beforeRequest()
    check(config)
    config.headers.set('Authorization', `Bearer ${authSession.getToken()}`)
    if (config.data instanceof FormData) config.headers.setContentType(false)
    return config
  } catch (error) { config.scope?.release(); throw error }
})
http.interceptors.response.use(response => {
  const config = response.config as ScopedConfig
  try { check(config) } catch (error) {
    if (response.data instanceof ReadableStream) void response.data.cancel().catch(() => {})
    config.scope?.release()
    throw error
  }
  if (response.data instanceof ReadableStream) {
    const reader = response.data.getReader()
    const release = () => { config.signal?.removeEventListener?.('abort', abort); config.scope?.release() }
    const abort = () => { void reader.cancel().catch(() => {}); release() }
    config.signal?.addEventListener?.('abort', abort, { once: true })
    response.data = new ReadableStream({
      async pull(controller) {
        try {
          check(config)
          const { done, value } = await reader.read()
          check(config)
          if (done) { controller.close(); release(); reader.releaseLock() }
          else controller.enqueue(value)
        } catch (error) { controller.error(error); release(); void reader.cancel().catch(() => {}) }
      },
      async cancel() { try { await reader.cancel() } finally { release() } },
    })
  } else config.scope?.release()
  return response
}, async (error: unknown) => {
  if (!axios.isAxiosError(error)) throw error
  const config = error.config as ScopedConfig | undefined
  if (!config) throw error
  let transferredToStream = false
  try {
    check(config)
    if (axios.isCancel(error)) throw error
    if (error.response?.status === 401) {
      if (error.response.data instanceof ReadableStream) await error.response.data.cancel()
      if (!config.authRetried) {
        config.authRetried = true
        const rejectedToken = String(config.headers.get('Authorization')).replace(/^Bearer /, '')
        await authSession.refresh({ rejectedToken })
        check(config)
        const response = await http.request(config)
        transferredToStream = response.data instanceof ReadableStream
        return response
      }
      authSession.invalidate('登录已过期，请重新登录')
    }
    try { await normalizeHttpError(error) } catch (normalized) {
      // Parsing a Blob/stream error is asynchronous too; don't deliver an old error.
      if (error.response?.status !== 401) check(config)
      throw normalized
    }
  } finally { if (!transferredToStream) config.scope?.release() }
})
