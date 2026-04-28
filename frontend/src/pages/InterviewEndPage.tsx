import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiGetChatSessions } from '@/lib/api'
import type { InterviewFeedback } from '@/types/chat'

export function InterviewEndPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [rawFeedback, setRawFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      return
    }

    apiGetChatSessions()
      .then((list) => {
        const session = list.find((s) => s.id === sessionId)
        if (!session?.feedback) return

        setRawFeedback(session.feedback)
        try {
          setFeedback(JSON.parse(session.feedback) as InterviewFeedback)
        } catch {
          setFeedback(null)
        }
      })
      .finally(() => setLoading(false))
  }, [sessionId])

  const overallScore = useMemo(() => {
    if (!feedback) return null
    const v = feedback.overallScore
    return typeof v === 'number' ? v : null
  }, [feedback])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">面试结束报告</h1>
          <p className="text-sm text-muted-foreground">分项评分与改进建议</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/interview')}>
          返回面试
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载报告中…</div>
      ) : !rawFeedback ? (
        <Card>
          <CardHeader>
            <CardTitle>暂无评价</CardTitle>
            <CardDescription>请先在模拟面试页面点击“结束面试”。</CardDescription>
          </CardHeader>
        </Card>
      ) : !feedback ? (
        <Card>
          <CardHeader>
            <CardTitle>评价数据解析失败</CardTitle>
            <CardDescription>展示原始反馈内容。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm">{rawFeedback}</pre>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>总体评分</CardTitle>
              <CardDescription>基于对话内容与 JD 匹配度综合评估</CardDescription>
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
              <CardTitle>分项评分</CardTitle>
              <CardDescription>每个维度给出分数与依据</CardDescription>
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
              {!feedback.aspects.length ? <div className="text-sm text-muted-foreground">暂无分项数据</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>改进建议</CardTitle>
              <CardDescription>按优先级汇总的行动项</CardDescription>
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
                        {priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}
                      </div>
                    </div>
                  </div>
                )
              })}
              {!feedback.improvements.length ? <div className="text-sm text-muted-foreground">暂无改进建议</div> : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

