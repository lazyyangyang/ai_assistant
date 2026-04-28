import { ChatPanel } from '@/components/chat'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { JDStructuredResult } from '@/types/chat'
import { useToast } from '@/contexts/ToastContext'

const SAVED_JD_KEY = 'saved_jd_result'

export function JDPage() {
  const { toast } = useToast()
  const [structured, setStructured] = useState<JDStructuredResult | null>(null)
  const [savedAt, setSavedAt] = useState<string>('')

  const canSave = useMemo(
    () =>
      !!structured &&
      (
        structured.skills.length > 0 ||
        structured.responsibilities.length > 0 ||
        structured.hard_requirements.length > 0 ||
        !!structured.summary
      ),
    [structured],
  )

  const handleSave = () => {
    if (!structured) return
    localStorage.setItem(SAVED_JD_KEY, JSON.stringify(structured))
    setSavedAt(new Date().toLocaleString())
    toast({ title: 'JD 已保存', message: '后续简历诊断与面试将使用该 JD', variant: 'success' })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium">结构化解析结果</h2>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            保存结果
          </Button>
        </div>
        {savedAt && <p className="mb-2 text-xs text-muted-foreground">已保存：{savedAt}</p>}
        {!structured ? (
          <p className="text-sm text-muted-foreground">发送 JD 后会在这里展示结构化结果卡片。</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">技能列表</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.skills.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">岗位职责</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.responsibilities.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">硬性要求</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {structured.hard_requirements.map((item, idx) => (
                  <li key={`${item}-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
            {!!structured.summary && (
              <div className="rounded-md border border-border p-3 md:col-span-3">
                <p className="mb-2 text-sm font-medium">核心关注点</p>
                <p className="text-sm">{structured.summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <ChatPanel
        title="JD 智能解析"
        agentType="jd"
        onStructuredData={setStructured}
        systemGreeting="你好！请将岗位描述（JD）粘贴到下方，我会帮你提取关键技能要求、岗位职责等结构化信息。"
      />
    </div>
  )
}
