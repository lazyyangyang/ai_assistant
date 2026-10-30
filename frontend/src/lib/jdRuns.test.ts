// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { http } from './http'
import { observeJDRun, type JDRun } from './jdRuns'
vi.mock('./authSession', () => ({ authSession: { captureIdentity: () => ({}), isCurrent: () => true } }))

it('replaces snapshots, ignores duplicate events and confirms completion from SQLite API', async () => {
  const initial: JDRun = { id: 'r', session_id: 's', status: 'running', phase: 'analysis', result_text: '', structured_json: null, error_code: null, cancel_requested: false, assistant_message_id: 'a' }
  const frames = `event: snapshot\nid: 1-0\ndata: ${JSON.stringify({ ...initial, result_text: '中' })}\n\nevent: token\nid: 2-0\ndata: {"content":"文"}\n\nevent: token\nid: 2-0\ndata: {"content":"文"}\n\nevent: completed\ndata: {}\n\n`
  const bytes = new TextEncoder().encode(frames)
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
    controller.close()
  } })
  const get = vi.spyOn(http, 'get').mockResolvedValueOnce({ data: initial })
    .mockResolvedValueOnce({ data: stream })
    .mockResolvedValueOnce({ data: { ...initial, status: 'succeeded', result_text: '中文' } })
  const states: JDRun[] = []
  try {
    const result = await observeJDRun('r', new AbortController().signal, run => states.push(run))
    expect(result.status).toBe('succeeded')
    expect(states.some(run => run.result_text === '中文文')).toBe(false)
    expect(states.at(-1)?.result_text).toBe('中文')
    expect(get).toHaveBeenCalledTimes(3)
  } finally { get.mockRestore() }
})

it.each([60, 80])('keeps %i concurrent JD observers isolated with split Chinese SSE', async (count) => {
  const initial = (id: string): JDRun => ({ id, session_id: `s-${id}`, status: 'running', phase: 'analysis', result_text: '', structured_json: null, error_code: null, cancel_requested: false, assistant_message_id: `a-${id}` })
  const started = performance.now()
  const completed = new Set<string>()
  const get = vi.spyOn(http, 'get').mockImplementation(async (url) => {
    const id = String(url).split('/')[3]
    if (String(url).includes('/events')) {
      const bytes = new TextEncoder().encode(`event: snapshot\nid: 1-0\ndata: ${JSON.stringify(initial(id))}\n\nevent: token\nid: 2-0\ndata: ${JSON.stringify({ content: `中文-${id}` })}\n\nevent: token\nid: 2-0\ndata: ${JSON.stringify({ content: `中文-${id}` })}\n\nevent: completed\ndata: {}\n\n`)
      return { data: new ReadableStream({ async start(controller) {
        for (let i = 0; i < bytes.length; i += 3) { controller.enqueue(bytes.slice(i, i + 3)); await Promise.resolve() }
        completed.add(id); controller.close()
      } }) }
    }
    return { data: completed.has(id) ? { ...initial(id), status: 'succeeded', result_text: `中文-${id}` } : initial(id) }
  })
  try {
    const results = await Promise.all(Array.from({ length: count }, (_, i) => {
      const id = `r${i}`
      return observeJDRun(id, new AbortController().signal, run => {
        expect(['', `中文-${id}`]).toContain(run.result_text)
      })
    }))
    results.forEach((run, i) => { expect(run.status).toBe('succeeded'); expect(run.result_text).toBe(`中文-r${i}`) })
    console.info(JSON.stringify({ observers: count, completed: results.length, mockConsumerElapsedMs: Math.round(performance.now() - started) }))
  } finally { get.mockRestore() }
})
