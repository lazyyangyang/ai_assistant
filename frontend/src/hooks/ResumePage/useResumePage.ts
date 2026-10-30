import { authSession } from '@/lib/authSession'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import { useResumeSelection } from '@/hooks/useResumeSelection'
import axios from 'axios'
import { useResumesData } from '@/hooks/useResumesData'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'
import {
  apiCreateResumeVersion,
  apiDeleteResume,
  apiUpdateResume,
  apiUploadResume,
} from '@/lib/api'
import { loadSavedJdResult } from '@/lib/jdStorage'
import type { JDStructuredResult } from '@/types/chat'

function writeError(error: unknown) {
  if (axios.isAxiosError(error) && !error.response) return '提交结果未确认，请先重试同步核对列表，避免重复提交。'
  return (error as Error).message
}

export function useResumePage() {
  const { toast } = useToast()
  const begin = useOperationGuard()
  const { resumes, loaded, error: syncError, refresh: loadResumes } = useResumesData()
  const { selectedResumeId, setSelectedResumeId } = useResumeSelection(resumes, loaded)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [savedJdContext] = useState<JDStructuredResult | null>(loadSavedJdResult)
  const [latestAssistantMessage, setLatestAssistantMessage] = useState('')
  const [savingNewVersion, setSavingNewVersion] = useState(false)
  useEffect(() => authSession.subscribe(() => {
    if (!authSession.canRequest()) { setUploading(false); setSavingNewVersion(false) }
  }), [])



  const selectedResume = useMemo(
    () => resumes.find((item) => item.id === selectedResumeId) ?? null,
    [resumes, selectedResumeId],
  )

  const handleUpload = useCallback(async () => {
    if (!file || uploading) return
    const operation = begin()
    setUploading(true)
    setError('')

    try {
      await apiUploadResume(file, title, { signal: operation.signal })
      if (!operation.current()) return
      toast({ title: t('ResumePage.uploadSuccessTitle'), message: t('ResumePage.uploadSuccessMessage'), variant: 'success' })
      setTitle('')
      setFile(null)
      await loadResumes()
      if (!operation.current()) return
    } catch (err) {
      if (!operation.current() || axios.isCancel(err)) return
      const msg = writeError(err)
      setError(msg)
      toast({ title: t('ResumePage.uploadFailureTitle'), message: msg, variant: 'error' })
    } finally {
      if (operation.current()) setUploading(false)
      operation.release()
    }
  }, [file, loadResumes, toast, title, uploading, begin])

  const handleSetActive = useCallback(
    async (resumeId: string) => {
      const operation = begin()
      setError('')
      try {
        await apiUpdateResume(resumeId, { is_active: true }, { signal: operation.signal })
        if (!operation.current()) return
        await loadResumes()
      if (!operation.current()) return
        setSelectedResumeId(resumeId)
        toast({ title: t('ResumePage.setActiveSuccessTitle'), message: t('ResumePage.setActiveSuccessMessage'), variant: 'success' })
      } catch (err) {
        if (!operation.current() || axios.isCancel(err)) return
        const msg = writeError(err)
        setError(msg)
        toast({ title: t('ResumePage.setActiveFailureTitle'), message: msg, variant: 'error' })
      } finally { operation.release() }
    },
    [loadResumes, toast, begin, setSelectedResumeId],
  )

  const handleDelete = useCallback(
    async (resumeId: string) => {
      const operation = begin()
      setError('')
      try {
        await apiDeleteResume(resumeId, { signal: operation.signal })
        if (!operation.current()) return
        await loadResumes()
      if (!operation.current()) return
        toast({ title: t('ResumePage.deleteSuccessTitle'), message: t('ResumePage.deleteSuccessMessage'), variant: 'success' })
      } catch (err) {
        if (!operation.current() || axios.isCancel(err)) return
        const msg = writeError(err)
        setError(msg)
        toast({ title: t('ResumePage.deleteFailureTitle'), message: msg, variant: 'error' })
      } finally { operation.release() }
    },
    [loadResumes, toast, begin],
  )

  const handleSaveDiagnosisAsVersion = useCallback(async () => {
    const content = latestAssistantMessage.trim()
    if (!content || savingNewVersion) return
    const operation = begin()
    setSavingNewVersion(true)
    setError('')

    try {
      const baseTitle = selectedResume?.title || t('ResumePage.defaultResumeTitle')
      await apiCreateResumeVersion({
        title: `${baseTitle}${t('ResumePage.optimizedTitleSuffix')}`,
        content,
        is_active: true,
      }, { signal: operation.signal })
      if (!operation.current()) return
      toast({ title: t('ResumePage.saveVersionSuccessTitle'), message: t('ResumePage.saveVersionSuccessMessage'), variant: 'success' })
      await loadResumes()
      if (!operation.current()) return
    } catch (err) {
      if (!operation.current() || axios.isCancel(err)) return
      const msg = writeError(err)
      setError(msg)
      toast({ title: t('ResumePage.saveVersionFailureTitle'), message: msg, variant: 'error' })
    } finally {
      if (operation.current()) setSavingNewVersion(false)
      operation.release()
    }
  }, [latestAssistantMessage, loadResumes, savingNewVersion, selectedResume, toast, begin])

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
  }
}
