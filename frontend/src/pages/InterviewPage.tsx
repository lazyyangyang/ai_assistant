import { ChatPanel } from '@/components/chat'
import { useEffect, useState } from 'react'
import { apiGetResumes, type ResumeDTO } from '@/lib/api'
import type { JDStructuredResult } from '@/types/chat'

const SAVED_JD_KEY = 'saved_jd_result'

export function InterviewPage() {
  const [resumes, setResumes] = useState<ResumeDTO[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [savedJdContext, setSavedJdContext] = useState<JDStructuredResult | null>(null)

  useEffect(() => {
    apiGetResumes()
      .then((list) => {
        setResumes(list)
        const active = list.find((item) => item.is_active)
        setSelectedResumeId(active?.id ?? list[0]?.id ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem(SAVED_JD_KEY)
    if (!raw) return
    try {
      setSavedJdContext(JSON.parse(raw) as JDStructuredResult)
    } catch {
      setSavedJdContext(null)
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium">面试简历上下文</p>
        <select
          value={selectedResumeId ?? ''}
          onChange={(e) => setSelectedResumeId(e.target.value || null)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {!resumes.length && <option value="">暂无可选简历</option>}
          {resumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {resume.title}（v{resume.version}）{resume.is_active ? ' · 当前使用' : ''}
            </option>
          ))}
        </select>
      </div>

      <ChatPanel
        title="模拟面试"
        agentType="interview"
        selectedResumeId={selectedResumeId}
        selectedJdContext={savedJdContext}
        systemGreeting="你好！我是你的 AI 面试官。请先告诉我你的目标岗位，我将根据你的简历和 JD 进行一场沉浸式模拟面试。准备好了就说「开始面试」。"
        enableVoiceOutput
      />
    </div>
  )
}
