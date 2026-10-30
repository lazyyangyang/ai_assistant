import { ChatPanel } from '@/components/chat'
import { useInterviewPage } from '@/hooks/InterviewPage/useInterviewPage'
import { t } from '@/lib/i18n'

export function InterviewPage() {
  const { resumes, syncError, refresh, selectedResumeId, setSelectedResumeId, savedJdContext } = useInterviewPage()

  return (
    <div className="space-y-4">
      {syncError && <p role="alert">简历列表同步失败：{syncError} <button onClick={() => void refresh()}>重试同步</button></p>}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium">{t('InterviewPage.contextTitle')}</p>
        <select
          value={selectedResumeId ?? ''}
          onChange={(e) => setSelectedResumeId(e.target.value || null)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">请选择简历</option>
          {resumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {t('InterviewPage.resumeOption', { title: resume.title, version: resume.version })}
              {resume.is_active ? t('InterviewPage.currentSuffix') : ''}
            </option>
          ))}
        </select>
      </div>

      <ChatPanel
        title={t('InterviewPage.chatTitle')}
        agentType="interview"
        selectedResumeId={selectedResumeId}
        selectedJdContext={savedJdContext}
        systemGreeting={t('InterviewPage.systemGreeting')}
        enableVoiceOutput
      />
    </div>
  )
}
