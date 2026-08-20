import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'
import {
  apiCreateResumeVersion,
  apiDeleteResume,
  apiGetResumes,
  apiUpdateResume,
  apiUploadResume,
  type ResumeDTO,
} from '@/lib/api'
import { loadSavedJdResult } from '@/lib/jdStorage'
import { useChatStore } from '@/stores/chatStore'
import type { JDStructuredResult } from '@/types/chat'

export function useResumePage() {
  const { toast } = useToast()
  const [resumes, setResumes] = useState<ResumeDTO[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [savedJdContext, setSavedJdContext] = useState<JDStructuredResult | null>(null)
  // Read the diagnosis directly from the chat domain Store. This removes a
  // ChatPanel -> page callback whose only purpose was mirroring the same value.
  const latestAssistantMessage = useChatStore((state) => {
    const messages = state.messagesByAgent.resume
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'assistant' && message.content.trim()) return message.content
    }
    return ''
  })
  const [savingNewVersion, setSavingNewVersion] = useState(false)

  const loadResumes = useCallback(async () => {
    const list = await apiGetResumes()
    setResumes(list)
    if (!list.length) {
      setSelectedResumeId(null)
      return
    }

    setSelectedResumeId((prev) => {
      // Preserve the user's explicit selection across refreshes; only fall back
      // when that version was deleted or this is the initial load.
      if (prev && list.some((item) => item.id === prev)) return prev
      const active = list.find((item) => item.is_active)
      return active?.id ?? list[0].id
    })
  }, [])

  useEffect(() => {
    loadResumes().catch((err) => setError((err as Error).message))
  }, [loadResumes])

  useEffect(() => {
    // Saved JD context is an explicit user choice and can be reused to align a
    // resume diagnosis with the same target role after navigating between pages.
    setSavedJdContext(loadSavedJdResult())
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
      toast({ title: t('ResumePage.uploadSuccessTitle'), message: t('ResumePage.uploadSuccessMessage'), variant: 'success' })
      setTitle('')
      setFile(null)
      await loadResumes()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: t('ResumePage.uploadFailureTitle'), message: msg, variant: 'error' })
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
        toast({ title: t('ResumePage.setActiveSuccessTitle'), message: t('ResumePage.setActiveSuccessMessage'), variant: 'success' })
      } catch (err) {
        const msg = (err as Error).message
        setError(msg)
        toast({ title: t('ResumePage.setActiveFailureTitle'), message: msg, variant: 'error' })
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
        toast({ title: t('ResumePage.deleteSuccessTitle'), message: t('ResumePage.deleteSuccessMessage'), variant: 'success' })
      } catch (err) {
        const msg = (err as Error).message
        setError(msg)
        toast({ title: t('ResumePage.deleteFailureTitle'), message: msg, variant: 'error' })
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
      const baseTitle = selectedResume?.title || t('ResumePage.defaultResumeTitle')
      await apiCreateResumeVersion({
        title: `${baseTitle}${t('ResumePage.optimizedTitleSuffix')}`,
        content,
        is_active: true,
      })
      toast({ title: t('ResumePage.saveVersionSuccessTitle'), message: t('ResumePage.saveVersionSuccessMessage'), variant: 'success' })
      await loadResumes()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: t('ResumePage.saveVersionFailureTitle'), message: msg, variant: 'error' })
    } finally {
      setSavingNewVersion(false)
    }
  }, [latestAssistantMessage, loadResumes, savingNewVersion, selectedResume?.title, toast])

  return {
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
    savedJdContext,
    latestAssistantMessage,
    savingNewVersion,
    handleUpload,
    handleSetActive,
    handleDelete,
    handleSaveDiagnosisAsVersion,
  }
}
