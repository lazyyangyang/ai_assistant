import { create } from 'zustand'
import {
  apiGetChatSessionMessages,
  apiGetChatSessions,
  type ChatSessionDTO,
} from '@/lib/api'
import {
  ChatStreamUnauthorizedError,
  abortAllChatStreams,
  stopChatStream,
  streamChat,
} from '@/lib/chatStreamClient'
import { t } from '@/lib/i18n'
import type {
  AgentType,
  ChatMessage,
  ChatSessionStatus,
  ChatSessionSummary,
  JDStructuredResult,
} from '@/types/chat'

// Store 只保存当前浏览器会话中的聊天视图状态，不使用 persist 中间件。
// 服务端数据库才是历史消息真源，避免本地缓存与 generating/stopped 等终态长期不一致。
const agentTypes: AgentType[] = ['jd', 'resume', 'interview']

function createAgentRecord<T>(factory: () => T): Record<AgentType, T> {
  // 每个 Agent 都调用一次 factory，确保数组等可变值不会在不同业务页之间共享引用。
  return Object.fromEntries(agentTypes.map((agentType) => [agentType, factory()])) as Record<
    AgentType,
    T
  >
}

let nextMessageId = 1
// 退出登录时仅清空 state 不足以阻止在途 Promise 回写。
// generation 相当于一次内存会话版本号，旧请求完成后会因版本不匹配而被丢弃。
let storeGeneration = 0

function createMessageId() {
  return `msg-${nextMessageId++}`
}

function buildGreeting(greeting?: string): ChatMessage[] {
  // 欢迎语只用于前端空会话展示，不属于真实对话历史，也不会发送给模型或写入数据库。
  if (!greeting) return []
  return [
    {
      id: createMessageId(),
      role: 'assistant',
      content: greeting,
      createdAt: Date.now(),
    },
  ]
}

function mapSessionSummary(session: ChatSessionDTO): ChatSessionSummary {
  return {
    id: session.id,
    agentType: session.agent_type,
    title: session.title,
    jdContent: session.jd_content,
    status: session.status as ChatSessionStatus,
    feedback: session.feedback ?? null,
    updatedAt: Date.parse(session.updated_at),
  }
}

function parseStructuredResult(session?: ChatSessionSummary): JDStructuredResult | null {
  if (!session?.jdContent) return null
  try {
    return JSON.parse(session.jdContent) as JDStructuredResult
  } catch {
    // 历史数据损坏不应阻断会话切换；消息本身仍然可以正常查看。
    return null
  }
}

interface SendMessageOptions {
  agentType: AgentType
  content: string
  resumeId?: string | null
  jdContext?: JDStructuredResult | null
}

interface ChatStoreState {
  sessionsByAgent: Record<AgentType, ChatSessionSummary[]>
  activeSessionIdByAgent: Record<AgentType, string | null>
  messagesByAgent: Record<AgentType, ChatMessage[]>
  streamingByAgent: Record<AgentType, boolean>
  greetingsByAgent: Record<AgentType, string | undefined>
  structuredByAgent: Record<AgentType, JDStructuredResult | null>
  initializeAgent: (agentType: AgentType, greeting?: string) => void
  loadSessions: (agentType: AgentType) => Promise<void>
  selectSession: (agentType: AgentType, sessionId: string) => Promise<void>
  createNewChat: (agentType: AgentType) => void
  sendMessage: (options: SendMessageOptions) => Promise<void>
  stopGeneration: (agentType: AgentType) => void
}

function createInitialData() {
  return {
    sessionsByAgent: createAgentRecord<ChatSessionSummary[]>(() => []),
    activeSessionIdByAgent: createAgentRecord<string | null>(() => null),
    messagesByAgent: createAgentRecord<ChatMessage[]>(() => []),
    streamingByAgent: createAgentRecord<boolean>(() => false),
    greetingsByAgent: createAgentRecord<string | undefined>(() => undefined),
    structuredByAgent: createAgentRecord<JDStructuredResult | null>(() => null),
  }
}

export const useChatStore = create<ChatStoreState>()((set, get) => ({
  ...createInitialData(),

  initializeAgent: (agentType, greeting) => {
    const state = get()
    const hasConversation =
      state.activeSessionIdByAgent[agentType] !== null
      || state.messagesByAgent[agentType].length > 0

    // 路由切换回来时保留已有会话，避免组件重新挂载把正在查看的内容重置为欢迎语。
    set({
      greetingsByAgent: { ...state.greetingsByAgent, [agentType]: greeting },
      messagesByAgent: hasConversation
        ? state.messagesByAgent
        : { ...state.messagesByAgent, [agentType]: buildGreeting(greeting) },
    })
  },

  loadSessions: async (agentType) => {
    const generation = storeGeneration
    const sessions = (await apiGetChatSessions())
      .filter((session) => session.agent_type === agentType)
      .map(mapSessionSummary)
    // API 返回时用户可能已经退出登录，此时不能把上一用户的会话重新写回 Store。
    if (generation !== storeGeneration) return
    set((state) => ({
      sessionsByAgent: { ...state.sessionsByAgent, [agentType]: sessions },
    }))
  },

  selectSession: async (agentType, sessionId) => {
    // 生成过程中切换历史会让同一 Agent 的 token 写入错误会话，因此在流结束前拒绝切换。
    if (get().streamingByAgent[agentType]) return
    const generation = storeGeneration

    set((state) => ({
      activeSessionIdByAgent: {
        ...state.activeSessionIdByAgent,
        [agentType]: sessionId,
      },
      messagesByAgent: { ...state.messagesByAgent, [agentType]: [] },
      structuredByAgent: agentType === 'jd'
        ? {
            ...state.structuredByAgent,
            jd: parseStructuredResult(
              state.sessionsByAgent.jd.find((session) => session.id === sessionId),
            ),
          }
        : state.structuredByAgent,
    }))

    const history = await apiGetChatSessionMessages(sessionId)
    // 用户可能连续点击多个会话；只接受最后一次选择对应的响应，避免慢请求覆盖快请求。
    if (
      generation !== storeGeneration
      || get().activeSessionIdByAgent[agentType] !== sessionId
    ) return

    set((state) => ({
      messagesByAgent: {
        ...state.messagesByAgent,
        [agentType]: history.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: Date.parse(message.created_at),
        })),
      },
    }))
  },

  createNewChat: (agentType) => {
    const state = get()
    set({
      activeSessionIdByAgent: {
        ...state.activeSessionIdByAgent,
        [agentType]: null,
      },
      messagesByAgent: {
        ...state.messagesByAgent,
        [agentType]: buildGreeting(state.greetingsByAgent[agentType]),
      },
      structuredByAgent: agentType === 'jd'
        ? { ...state.structuredByAgent, jd: null }
        : state.structuredByAgent,
    })
  },

  sendMessage: async ({ agentType, content, resumeId, jdContext }) => {
    const userContent = content.trim()
    const state = get()
    if (!userContent || state.streamingByAgent[agentType]) return
    const generation = storeGeneration

    // 先乐观插入用户消息和空助手消息，让输入立即得到反馈；后续 token 只更新该助手占位项。
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    }
    const assistantMessageId = createMessageId()
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }
    const updatedMessages = [...state.messagesByAgent[agentType], userMessage]

    set({
      messagesByAgent: {
        ...state.messagesByAgent,
        [agentType]: [...updatedMessages, assistantMessage],
      },
      streamingByAgent: { ...state.streamingByAgent, [agentType]: true },
    })

    let assistantContent = ''
    let lastRenderAt = 0
    const commitAssistantContent = () => {
      if (generation !== storeGeneration) return
      set((current) => ({
        messagesByAgent: {
          ...current.messagesByAgent,
          [agentType]: current.messagesByAgent[agentType].map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: assistantContent }
              : message,
          ),
        },
      }))
      // 这是 React 渲染节流，不影响 SSE 接收，也不同于后端按字符/时间批量落库。
      lastRenderAt = performance.now()
    }

    try {
      const greeting = state.greetingsByAgent[agentType]
      await streamChat({
        agentType,
        // 欢迎语是前端装饰消息，排除它可避免模型把固定 UI 文案误当作自己的历史回答。
        messages: updatedMessages
          .filter((message) => message.content !== greeting)
          .map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        sessionId: state.activeSessionIdByAgent[agentType],
        resumeId,
        jdContext,
        onSessionId: (sessionId) => {
          if (generation !== storeGeneration) return
          set((current) => ({
            activeSessionIdByAgent: {
              ...current.activeSessionIdByAgent,
              [agentType]: sessionId,
            },
          }))
        },
        onToken: (token) => {
          if (generation !== storeGeneration) return
          assistantContent += token
          const now = performance.now()
          // 高频 token 合并到约 30ms 一次状态更新，减少 Markdown 和虚拟列表重复渲染。
          if (!lastRenderAt || now - lastRenderAt >= 30) {
            commitAssistantContent()
          }
        },
        onStructuredData: (data) => {
          if (generation !== storeGeneration) return
          set((current) => ({
            structuredByAgent: {
              ...current.structuredByAgent,
              [agentType]: data,
            },
          }))
        },
      })

      if (assistantContent) commitAssistantContent()
    } catch (error) {
      if (generation !== storeGeneration) return
      if (error instanceof ChatStreamUnauthorizedError) {
        // 全局鉴权处理器会负责退出登录；这里只移除尚未生成内容的乐观占位消息。
        set((current) => ({
          messagesByAgent: {
            ...current.messagesByAgent,
            [agentType]: current.messagesByAgent[agentType].filter(
              (message) => message.id !== assistantMessageId,
            ),
          },
        }))
      } else if ((error as Error).name === 'AbortError') {
        // 用户停止时仍刷新最后一小段未达到 30ms 阈值的内容，保证界面与后端 partial 尽量一致。
        if (assistantContent) commitAssistantContent()
      } else {
        assistantContent = assistantContent || t('chatStore.requestFailure')
        commitAssistantContent()
      }
    } finally {
      if (generation === storeGeneration) {
        set((current) => ({
          streamingByAgent: {
            ...current.streamingByAgent,
            [agentType]: false,
          },
        }))
        // 流结束后以服务端元数据刷新标题、更新时间和 completed 状态。
        await get().loadSessions(agentType).catch(() => {})
      }
    }
  },

  stopGeneration: (agentType) => {
    const state = get()
    // 客户端立即结束加载状态；stream client 同时通知后端并中断本地读取。
    stopChatStream(agentType, state.activeSessionIdByAgent[agentType])
    set({
      streamingByAgent: { ...state.streamingByAgent, [agentType]: false },
    })
  },

}))

export function resetChatStore(): void {
  // 先让所有旧回调失效，再中断网络流，防止 AbortError 清理逻辑把上一用户数据写回来。
  storeGeneration += 1
  abortAllChatStreams()
  useChatStore.setState(createInitialData())
}
