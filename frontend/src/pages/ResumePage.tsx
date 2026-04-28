import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChatPanel } from '@/components/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  apiCreateResumeVersion,
  apiDeleteResume,
  apiGetResumes,
  apiUpdateResume,
  apiUploadResume,
  type ResumeDTO,
} from '@/lib/api'
import type { JDStructuredResult } from '@/types/chat'
import { useToast } from '@/contexts/ToastContext'

const SAVED_JD_KEY = 'saved_jd_result'

export function ResumePage() {
  const { toast } = useToast()
  const [resumes, setResumes] = useState<ResumeDTO[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [savedJdContext, setSavedJdContext] = useState<JDStructuredResult | null>(null)
  const [latestAssistantMessage, setLatestAssistantMessage] = useState('')
  const [savingNewVersion, setSavingNewVersion] = useState(false)

  const loadResumes = useCallback(async () => {
    const list = await apiGetResumes()
    setResumes(list)
    if (!list.length) {
      setSelectedResumeId(null)
      return
    }
    setSelectedResumeId((prev) => {
      if (prev && list.some((item) => item.id === prev)) return prev
      const active = list.find((item) => item.is_active)
      return active?.id ?? list[0].id
    })
  }, [])

  useEffect(() => {
    loadResumes().catch((err) => setError((err as Error).message))
  }, [loadResumes])

  useEffect(() => {
    const raw = localStorage.getItem(SAVED_JD_KEY)
    if (!raw) return
    try {
      setSavedJdContext(JSON.parse(raw) as JDStructuredResult)
    } catch {
      setSavedJdContext(null)
    }
  }, [])

  const selectedResume = useMemo(
    () => resumes.find((item) => item.id === selectedResumeId) ?? null,
    [resumes, selectedResumeId],
  )

  const handleUpload = useCallback(async () => {
    if (!file || uploading) return
    setUploading(true)
    setError('')
    try {
      await apiUploadResume(file, title)
      toast({ title: '上传成功', message: '简历已解析并保存为新版本', variant: 'success' })
      setTitle('')
      setFile(null)
      await loadResumes()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: '上传失败', message: msg, variant: 'error' })
    } finally {
      setUploading(false)
    }
  }, [file, loadResumes, toast, title, uploading])

  const handleSetActive = useCallback(
    async (resumeId: string) => {
      setError('')
      try {
        await apiUpdateResume(resumeId, { is_active: true })
        await loadResumes()
        setSelectedResumeId(resumeId)
        toast({ title: '已切换当前版本', message: '后续对话将使用该简历', variant: 'success' })
      } catch (err) {
        const msg = (err as Error).message
        setError(msg)
        toast({ title: '切换失败', message: msg, variant: 'error' })
      }
    },
    [loadResumes, toast],
  )

  const handleDelete = useCallback(
    async (resumeId: string) => {
      setError('')
      try {
        await apiDeleteResume(resumeId)
        await loadResumes()
        toast({ title: '删除成功', message: '该简历版本已移除', variant: 'success' })
      } catch (err) {
        const msg = (err as Error).message
        setError(msg)
        toast({ title: '删除失败', message: msg, variant: 'error' })
      }
    },
    [loadResumes, toast],
  )

  const handleSaveDiagnosisAsVersion = useCallback(async () => {
    const content = latestAssistantMessage.trim()
    if (!content || savingNewVersion) return
    setSavingNewVersion(true)
    setError('')
    try {
      const baseTitle = selectedResume?.title || '简历'
      await apiCreateResumeVersion({
        title: `${baseTitle}-AI优化版`,
        content,
        is_active: true,
      })
      toast({ title: '已保存为新版本', message: '诊断/重写结果已生成新简历版本', variant: 'success' })
      await loadResumes()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: '保存失败', message: msg, variant: 'error' })
    } finally {
      setSavingNewVersion(false)
    }
  }, [latestAssistantMessage, loadResumes, savingNewVersion, selectedResume?.title, toast])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-base font-medium">简历版本管理</h2>
          <p className="text-sm text-muted-foreground">
            支持上传 PDF / TXT / DOCX；新上传版本会自动设为当前活跃版本。
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
              placeholder="简历标题（可选）"
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
            {uploading ? '上传中…' : '上传简历'}
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
                      {resume.title}（v{resume.version}）
                      {resume.is_active ? ' · 当前使用' : ''}
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
                      设为当前
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleDelete(resume.id).catch(() => {})
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              {!resumes.length && (
                <p className="px-2 py-1 text-sm text-muted-foreground">还没有上传简历</p>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium">内容预览</p>
            <p className="mb-2 text-xs text-muted-foreground">
              当前对话将使用选中简历作为上下文。
            </p>
            <div className="max-h-44 overflow-auto whitespace-pre-wrap text-sm">
              {selectedResume?.content || '请选择一个简历版本'}
            </div>
            <Button
              className="mt-3 w-full"
              variant="outline"
              onClick={() => {
                handleSaveDiagnosisAsVersion().catch(() => {})
              }}
              disabled={!latestAssistantMessage.trim() || savingNewVersion}
            >
              {savingNewVersion ? '保存中…' : '将最近诊断结果保存为新版本'}
            </Button>
          </div>
        </div>
      </div>

      <ChatPanel
        title="简历诊断与重写"
        agentType="resume"
        selectedResumeId={selectedResumeId}
        selectedJdContext={savedJdContext}
        onLatestAssistantMessageChange={setLatestAssistantMessage}
        systemGreeting="你好！请上传或粘贴你的简历内容，我会对照目标 JD 进行深度诊断，并给出针对性的修改建议。"
      />
    </div>
  )
}
