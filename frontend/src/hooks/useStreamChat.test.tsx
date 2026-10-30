import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { apiStreamChat } from '@/lib/api'
import { useStreamChat } from './useStreamChat'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@/lib/authSession', () => ({ authSession: { canRequest: () => true, captureIdentity: () => ({}), isCurrent: () => true } }))
vi.mock('@/lib/api', () => ({ apiStreamChat: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/jd' }) }))
beforeEach(() => vi.clearAllMocks())

it('renders split UTF-8 SSE tokens, completing on DONE', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const data = new ReadableStream<Uint8Array>({ start(c) { source = c }, cancel })
  vi.mocked(apiStreamChat).mockResolvedValue({
    data, status: 200, statusText: 'OK', headers: new AxiosHeaders({ 'x-session-id': 'session' }),
    config: { headers: new AxiosHeaders() },
  })
  const onSessionChange = vi.fn()
  const { result } = renderHook(() => useStreamChat({ agentType: 'resume', onSessionChange }))
  let pending!: Promise<void>
  act(() => { pending = result.current.sendMessage('test') })
  await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith('session'))
  const bytes = new TextEncoder().encode('event: token\r\ndata: {"content":"你好"}\r\n\r\n')
  await act(async () => {
    for (const byte of bytes) source.enqueue(new Uint8Array([byte]))
  })
  await waitFor(() => expect(result.current.messages.at(-1)?.content).toBe('你好'))
  expect(result.current.isLoading).toBe(true)
  await act(async () => {
    source.enqueue(new TextEncoder().encode(`event: done\r\ndata: [DONE]\r\n\r\n`))
    await pending
  })
  expect(result.current.isLoading).toBe(false)
  expect(cancel).toHaveBeenCalled()
})

it('redirects on an Axios 401 after the HTTP layer has handled authentication', async () => {
  vi.mocked(apiStreamChat).mockRejectedValue(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, {
    data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config: { headers: new AxiosHeaders() },
  }))
  const { result } = renderHook(() => useStreamChat({ agentType: 'resume' }))
  await act(async () => { await result.current.sendMessage('test') })
  expect(navigate).toHaveBeenCalledWith('/login', expect.objectContaining({ replace: true }))
  expect(result.current.messages).toHaveLength(1)
})
