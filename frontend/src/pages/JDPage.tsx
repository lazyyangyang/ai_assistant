import { ChatPanel } from '@/components/chat'
import { Button } from '@/components/ui/button'
import { useJDPage } from '@/hooks/JDPage/useJDPage'
import { t } from '@/lib/i18n'

export function JDPage() {
  const { structured, savedAt, canSave, handleSave } = useJDPage()

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium">{t('JDPage.resultTitle')}</h2>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {t('JDPage.saveButton')}
          </Button>
        </div>
        {savedAt && <p className="mb-2 text-xs text-muted-foreground">{t('JDPage.savedAt', { savedAt })}</p>}
        {!structured ? (
          <p className="text-sm text-muted-foreground">{t('JDPage.emptyResult')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t('JDPage.skillsTitle')}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.skills.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t('JDPage.responsibilitiesTitle')}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.responsibilities.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t('JDPage.hardRequirementsTitle')}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.hard_requirements.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            {!!structured.summary && (
              <div className="rounded-md border border-border p-3 md:col-span-3">
                <p className="mb-2 text-sm font-medium">{t('JDPage.summaryTitle')}</p>
                <p className="text-sm">{structured.summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <ChatPanel
        title={t('JDPage.chatTitle')}
        agentType="jd"
        systemGreeting={t('JDPage.systemGreeting')}
      />
    </div>
  )
}
