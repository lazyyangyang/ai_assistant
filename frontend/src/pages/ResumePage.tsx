import { ChatPanel } from '@/components/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useResumePage } from '@/hooks/ResumePage/useResumePage'
import { t } from '@/lib/i18n'

export function ResumePage() {
  const {
    resumes,
    selectedResume,
    selectedResumeId,
    setSelectedResumeId,
    title,
    setTitle,
    file,
    setFile,
    uploading,
    error,
    syncError,
    loadResumes,
    savedJdContext,
    latestAssistantMessage,
    setLatestAssistantMessage,
    savingNewVersion,
    handleUpload,
    handleSetActive,
    handleDelete,
    handleSaveDiagnosisAsVersion,
  } = useResumePage()

  return (
    <div className="space-y-4">
      {syncError && <p role="alert">简历已保留，列表同步失败：{syncError} <button onClick={() => void loadResumes()}>重试同步</button></p>}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-base font-medium">{t('ResumePage.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('ResumePage.description')}
          </p>
        </div>

        {error && (
          <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Input
              placeholder={t('ResumePage.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              type="file"
              accept=".pdf,.txt,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? t('ResumePage.uploadLoading') : t('ResumePage.uploadButton')}
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="max-h-56 overflow-auto rounded-md border border-border p-2">
            <div className="space-y-2">
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  className={[
                    'rounded-md border px-3 py-2',
                    selectedResumeId === resume.id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedResumeId(resume.id)}
                    className="w-full text-left"
                  >
                    <p className="line-clamp-1 font-medium">
                      {t('ResumePage.resumeVersion', { title: resume.title, version: resume.version })}
                      {resume.is_active ? t('ResumePage.currentSuffix') : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(resume.updated_at).toLocaleString()}
                    </p>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleSetActive(resume.id).catch(() => {})
                      }}
                      disabled={resume.is_active}
                    >
                      {t('ResumePage.setActiveButton')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleDelete(resume.id).catch(() => {})
                      }}
                    >
                      {t('ResumePage.deleteButton')}
                    </Button>
                  </div>
                </div>
              ))}
              {!resumes.length && (
                <p className="px-2 py-1 text-sm text-muted-foreground">{t('ResumePage.emptyResumeList')}</p>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium">{t('ResumePage.previewTitle')}</p>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('ResumePage.previewDescription')}
            </p>
            <div className="max-h-44 overflow-auto whitespace-pre-wrap text-sm">
              {selectedResume?.content || t('ResumePage.previewEmpty')}
            </div>
            <Button
              className="mt-3 w-full"
              variant="outline"
              onClick={() => {
                handleSaveDiagnosisAsVersion().catch(() => {})
              }}
              disabled={!latestAssistantMessage.trim() || savingNewVersion}
            >
              {savingNewVersion ? t('ResumePage.saveDiagnosisLoading') : t('ResumePage.saveDiagnosisButton')}
            </Button>
          </div>
        </div>
      </div>

      <ChatPanel
        title={t('ResumePage.chatTitle')}
        agentType="resume"
        selectedResumeId={selectedResumeId}
        selectedJdContext={savedJdContext}
        onLatestAssistantMessageChange={setLatestAssistantMessage}
        systemGreeting={t('ResumePage.systemGreeting')}
      />
    </div>
  )
}
