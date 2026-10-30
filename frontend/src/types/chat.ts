export type MessageRole = 'user' | 'assistant'
export type AgentType = 'jd' | 'resume' | 'interview'
export type ChatSessionStatus = 'active' | 'completed'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
}

export interface ChatSessionSummary {
  id: string
  agentType: AgentType
  title: string
  resumeId?: string | null
  jdContent?: string | null
  status: ChatSessionStatus
  feedback?: string | null
  updatedAt: number
}

export interface JDStructuredResult {
  skills: string[]
  responsibilities: string[]
  hard_requirements: string[]
  summary: string
}

export interface InterviewFeedback {
  overallScore: number
  overallSummary: string
  aspects: Array<{ name: string; score: number; reason: string }>
  improvements: Array<{
    title: string
    detail: string
    priority: 'high' | 'medium' | 'low'
  }>
}
