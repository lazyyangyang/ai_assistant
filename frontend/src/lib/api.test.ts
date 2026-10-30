// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { http } from './http'
import { publicHttp, authTransport } from './authTransport'
import { authSession } from './authSession'
import { tokenResponse } from '@/test/authFixtures'
import {
  apiDeleteResume, apiGetMe, apiLogin, apiStreamChat, apiSynthesizeTts,
  apiUploadResume, apiRegister,
} from './api'

const fetchMock = vi.fn<typeof fetch>()
const token = tokenResponse().access_token
const getAccessToken = authSession.getToken
const clearAccessToken = () => authSession.invalidate()

beforeEach(async () => {
  fetchMock.mockReset()
  clearAccessToken()
  http.defaults.baseURL = 'http://localhost/api'
  http.defaults.env = { ...http.defaults.env, fetch: fetchMock }
  publicHttp.defaults.baseURL = 'http://localhost/api'
  publicHttp.defaults.env = { ...publicHttp.defaults.env, fetch: fetchMock }
  const spy = vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
  await authSession.login({ email: 'test@example.com', password: 'password' })
  authSession.identityLoaded(authSession.captureIdentity(), 'user')
  spy.mockRestore()
})

afterEach(() => clearAccessToken())

describe('Axios API transport', () => {
  it('registers an account without accepting a token or loading the current user', async () => {
    clearAccessToken()
    const user = { id: 'new-user', username: 'new-user', email: 'new@example.com' }
    fetchMock.mockResolvedValueOnce(Response.json(user, { status: 201 }))
    expect(await apiRegister(user.username, user.email, 'password')).toEqual(user)
    expect(getAccessToken()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0][0] as Request
    expect(request.url).toBe('http://localhost/api/auth/register')
    expect(await request.json()).toEqual({ username: user.username, email: user.email, password: 'password' })
  })

  it('serializes login and attaches the current token to later requests', async () => {
    clearAccessToken()
    fetchMock.mockResolvedValueOnce(Response.json(tokenResponse()))
    expect((await apiLogin('user@example.com', 'password')).access_token).toBe(token)
    const login = fetchMock.mock.calls[0][0] as Request
    expect(login.url).toBe('http://localhost/api/auth/login')
    expect(login.method).toBe('POST')
    expect(login.headers.get('Content-Type')).toContain('application/json')
    expect(await login.json()).toEqual({ email: 'user@example.com', password: 'password' })
    authSession.identityLoaded(authSession.captureIdentity(), 'user')
    fetchMock.mockImplementation(async () => Response.json({ id: '1', username: 'user', email: 'user@example.com' }))
    await apiGetMe()
    expect((fetchMock.mock.calls[1][0] as Request).headers.get('Authorization')).toBe(`Bearer ${token}`)
    clearAccessToken()
    await expect(apiGetMe()).rejects.toSatisfy(axios.isCancel)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uploads multipart data with a boundary and handles empty delete responses', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'resume' }))
    await apiUploadResume(new File(['resume content'], 'resume.txt'), 'Title')
    const request = fetchMock.mock.calls[0][0] as Request
    expect(request.headers.get('Content-Type')).toContain('multipart/form-data; boundary=')
    const form = await request.formData()
    expect(form.get('title')).toBe('Title')
    expect(await (form.get('file') as File).text()).toBe('resume content')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await apiDeleteResume('resume')).toBeUndefined()
  })

  it('returns audio and decodes JSON errors for blob and stream responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }))
    expect(await (await apiSynthesizeTts('hello')).text()).toBe('audio')
    fetchMock.mockResolvedValueOnce(Response.json({ detail: '语音合成失败' }, { status: 502 }))
    await expect(apiSynthesizeTts('hello')).rejects.toMatchObject({ message: '语音合成失败', response: { status: 502 } })
    fetchMock.mockResolvedValueOnce(Response.json({ detail: '无效 Token' }, { status: 403 }))
    await expect(apiStreamChat({ agent_type: 'jd', messages: [] }, new AbortController().signal))
      .rejects.toMatchObject({ message: '无效 Token', response: { status: 403 } })
  })

  it('delivers SSE chunks before the response completes and retains the session header', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'X-Session-Id': 'session-1' } }))
    const response = await apiStreamChat({ agent_type: 'jd', messages: [] }, new AbortController().signal)
    expect(response.headers['x-session-id']).toBe('session-1')
    const reader = response.data.getReader()
    const chunk = 'event: token\r\ndata: {"content":"你好"}\r\n\r\n'
    source.enqueue(new TextEncoder().encode(chunk))
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(chunk)
    source.close()
    expect((await reader.read()).done).toBe(true)
  })

  it('preserves cancellation instead of converting it into an API error', async () => {
    fetchMock.mockImplementation(async (input) => new Promise((_, reject) => {
      (input as Request).signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const pending = apiStreamChat({ agent_type: 'jd', messages: [] }, controller.signal)
    const assertion = expect(pending).rejects.toSatisfy(axios.isCancel)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()
    await assertion
  })

  it('coalesces concurrent 401 refreshes and retries each request only once', async () => {
    const replacement = `${token}-new`
    authSession.identityLoaded(authSession.captureIdentity(), 'user')
    let refreshes = 0
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request
      if (request.url.endsWith('/refresh')) {
        refreshes++
        expect(request.credentials).toBe('include')
        expect(request.headers.get('X-CSRF-Protection')).toBe('1')
        return Response.json({ ...tokenResponse(), access_token: replacement })
      }
      return request.headers.get('Authorization') === `Bearer ${token}`
        ? Response.json({ detail: 'expired' }, { status: 401 })
        : Response.json({ id: '1' })
    })
    const results = await Promise.all([apiGetMe(), apiGetMe(), apiGetMe()])
    expect(results.map((result) => result.id)).toEqual(['1', '1', '1'])
    expect(refreshes).toBe(1)
  })

  it('stops after a retried request also returns 401', async () => {
    authSession.identityLoaded(authSession.captureIdentity(), 'user')
    let refreshes = 0
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).url.endsWith('/refresh')) {
        refreshes++
        return Response.json({ ...tokenResponse(), access_token: `${token}-new` })
      }
      return Response.json({ detail: 'revoked' }, { status: 401 })
    })
    await expect(apiGetMe()).rejects.toMatchObject({ response: { status: 401 } })
    expect(refreshes).toBe(1)
  })

  it('rejects anonymous requests before transport and discards late success', async () => {
    clearAccessToken()
    await expect(apiGetMe()).rejects.toSatisfy(axios.isCancel)
    expect(fetchMock).not.toHaveBeenCalled()
    const spy = vi.spyOn(authTransport, 'login').mockResolvedValue(tokenResponse())
    await authSession.login({ email: 'test@example.com', password: 'password' })
    authSession.identityLoaded(authSession.captureIdentity(), 'user')
    spy.mockRestore()
    let release!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = apiGetMe()
    const assertion = expect(pending).rejects.toSatisfy(axios.isCancel)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    clearAccessToken()
    release(Response.json({ id: 'old-user' }))
    await assertion
  })
})

it('keeps a retried SSE registered until consumption ends', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
  fetchMock.mockResolvedValueOnce(Response.json({ detail: 'expired' }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ...tokenResponse(), access_token: `${token}-new` }))
    .mockResolvedValueOnce(new Response(stream))
  const response = await apiStreamChat({ agent_type: 'jd', messages: [] }, new AbortController().signal)
  const reader = response.data.getReader()
  const pending = reader.read()
  const assertion = expect(pending).rejects.toSatisfy(axios.isCancel)
  authSession.suspend()
  expect((fetchMock.mock.calls.at(-1)![0] as Request).signal.aborted).toBe(true)
  source.close() // The fetch mock has no network abort implementation.
  await assertion
})
