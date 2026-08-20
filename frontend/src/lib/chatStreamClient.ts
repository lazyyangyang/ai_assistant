import { apiStopChatSession, authenticatedFetch } from '@/lib/api'
import type { AgentType, JDStructuredResult, MessageRole } from '@/types/chat'

interface StreamMessage {
  role: MessageRole
  content: string
}

interface StreamChatOptions {
  agentType: AgentType
  messages: StreamMessage[]
  sessionId?: string | null
  resumeId?: string | null
  jdContext?: JDStructuredResult | null
  onSessionId: (sessionId: string) => void
  onToken: (token: string) => void
  onStructuredData: (data: JDStructuredResult) => void
}

interface ActiveStream {
  controller: AbortController
  sessionId: string | null
}

// AbortController 属于不可序列化的传输层对象，放在模块内比放进 Zustand 更符合职责边界。
// 以 Agent 为键也限制同一业务页同时只有一条活动流，避免 token 交叉写入同一消息列表。
const activeStreams = new Map<AgentType, ActiveStream>()

export class ChatStreamUnauthorizedError extends Error {
  constructor() {
    super('Chat stream unauthorized')
    this.name = 'ChatStreamUnauthorizedError'
  }
}

export async function streamChat({
  agentType,
  messages,
  sessionId,
  resumeId,
  jdContext,
  onSessionId,
  onToken,
  onStructuredData,
}: StreamChatOptions): Promise<void> {
  const controller = new AbortController()
  const activeStream: ActiveStream = {
    controller,
    sessionId: sessionId ?? null,
  }
  activeStreams.set(agentType, activeStream)

  try {
    const response = await authenticatedFetch('/chat/stream', {
      method: 'POST',
      body: JSON.stringify({
        agent_type: agentType,
        messages,
        session_id: sessionId ?? undefined,
        resume_id: resumeId ?? undefined,
        jd_context: jdContext ?? undefined,
      }),
      signal: controller.signal,
    })

    // 新会话 ID 在响应头中先于 SSE 正文到达，使“停止生成”在首个 token 前也能定位服务端会话。
    const returnedSessionId = response.headers.get('x-session-id')
    if (returnedSessionId) {
      activeStream.sessionId = returnedSessionId
      onSessionId(returnedSessionId)
    }

    if (response.status === 401) {
      throw new ChatStreamUnauthorizedError()
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''
    let eventType = 'token'
    let finished = false

    // ReadableStream 的 chunk 边界与 SSE 行边界无关，因此保留最后一个不完整行到下一轮拼接。
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trimEnd()
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim()
          continue
        }
        if (!line.startsWith('data:')) continue

        const rawData = line.slice(5).trimStart()
        if (rawData === '[DONE]' || eventType === 'done') {
          finished = true
          break
        }

        try {
          if (eventType === 'token') {
            const parsed = JSON.parse(rawData) as { content: string }
            onToken(parsed.content)
          } else if (eventType === 'structured') {
            onStructuredData(JSON.parse(rawData) as JDStructuredResult)
          }
        } catch {
          // A malformed event must not terminate an otherwise healthy stream.
        }
      }
    }
  } finally {
    // 仅由创建它的请求清理条目，避免旧请求结束时误删同 Agent 后来启动的新请求。
    if (activeStreams.get(agentType) === activeStream) {
      activeStreams.delete(agentType)
    }
  }
}

export function stopChatStream(agentType: AgentType, sessionId: string | null): void {
  const activeStream = activeStreams.get(agentType)
  const persistedSessionId = activeStream?.sessionId ?? sessionId
  if (persistedSessionId) {
    // 显式停止接口负责可靠记录 stopped；abort 则立即释放浏览器连接，两者缺一会影响状态或体验。
    void apiStopChatSession(persistedSessionId).catch(() => {})
  }
  activeStream?.controller.abort()
}

export function abortAllChatStreams(): void {
  // 认证失效时不再额外发受保护的 stop 请求，直接断流即可由后端取消处理保存 stopped。
  for (const activeStream of activeStreams.values()) {
    activeStream.controller.abort()
  }
}
