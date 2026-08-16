import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useInterviewEndPage } from '@/hooks/InterviewEndPage/useInterviewEndPage'
import { t } from '@/lib/i18n'

export function InterviewEndPage() {
  const { loading, feedback, rawFeedback, overallScore, goBackToInterview } = useInterviewEndPage()

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('InterviewEndPage.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('InterviewEndPage.description')}</p>
        </div>
        <Button variant="outline" onClick={goBackToInterview}>
          {t('InterviewEndPage.backButton')}
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('InterviewEndPage.loading')}</div>
      ) : !rawFeedback ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('InterviewEndPage.emptyTitle')}</CardTitle>
            <CardDescription>{t('InterviewEndPage.emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : !feedback ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('InterviewEndPage.parseFailureTitle')}</CardTitle>
            <CardDescription>{t('InterviewEndPage.parseFailureDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm">{rawFeedback}</pre>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('InterviewEndPage.overallScoreTitle')}</CardTitle>
              <CardDescription>{t('InterviewEndPage.overallScoreDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold">{overallScore}/10</div>
                <div className="text-sm text-muted-foreground">{feedback.overallSummary}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('InterviewEndPage.aspectScoresTitle')}</CardTitle>
              <CardDescription>{t('InterviewEndPage.aspectScoresDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {feedback.aspects.map((a, idx) => (
                <div key={`${a.name}-${idx}`} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-sm text-muted-foreground">{a.score}/10</div>
                  </div>
                  <div className="h-2 w-full rounded bg-muted/40 overflow-hidden">
                    <div
                      className="h-2 rounded bg-primary"
                      style={{ width: `${Math.max(0, Math.min(100, (a.score / 10) * 100))}%` }}
                    />
                  </div>
                  {a.reason ? <div className="text-xs text-muted-foreground">{a.reason}</div> : null}
                </div>
              ))}
              {!feedback.aspects.length ? <div className="text-sm text-muted-foreground">{t('InterviewEndPage.emptyAspectScores')}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('InterviewEndPage.improvementsTitle')}</CardTitle>
              <CardDescription>{t('InterviewEndPage.improvementsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {feedback.improvements.map((imp, idx) => {
                const priority = imp.priority
                const priorityClass =
                  priority === 'high'
                    ? 'bg-destructive/10 text-destructive'
                    : priority === 'medium'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted/60 text-muted-foreground'
                return (
                  <div
                    key={`${imp.title}-${idx}`}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium">{imp.title}</div>
                        <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                          {imp.detail}
                        </div>
                      </div>
                      <div className={`rounded-md px-2 py-1 text-xs font-medium ${priorityClass}`}>
                        {priority === 'high'
                          ? t('InterviewEndPage.priorityHigh')
                          : priority === 'medium'
                            ? t('InterviewEndPage.priorityMedium')
                            : t('InterviewEndPage.priorityLow')}
                      </div>
                    </div>
                  </div>
                )
              })}
              {!feedback.improvements.length ? <div className="text-sm text-muted-foreground">{t('InterviewEndPage.emptyImprovements')}</div> : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

