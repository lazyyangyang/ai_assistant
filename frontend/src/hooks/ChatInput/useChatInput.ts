import axios from 'axios'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import { authSession } from '@/lib/authSession'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { apiTranscribeAudio } from '@/lib/api'
import { t } from '@/lib/i18n'

interface UseChatInputOptions {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  enableVoiceInput?: boolean
}

function pickSupportedMimeType() {
  const candidates = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm',
  ]
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

export function useChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  enableVoiceInput = false,
}: UseChatInputOptions) {
  const begin = useOperationGuard()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeTypeRef = useRef('')
  const stopSeqRef = useRef(0)
  const releaseOperationRef = useRef<(() => void) | null>(null)

  const isVoiceBusy = isRecording || isTranscribing
  const busy = disabled || isVoiceBusy

  const cleanupStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
    }
    streamRef.current = null
  }

  useEffect(() => {
    const stop = () => {
      stopSeqRef.current++
      releaseOperationRef.current?.()
      releaseOperationRef.current = null
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.onstop = null
        recorder.ondataavailable = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      cleanupStream()
      mediaRecorderRef.current = null
      setIsRecording(false)
      setIsTranscribing(false)
    }
    const unsubscribe = authSession.subscribe(() => { if (!authSession.canRequest()) stop() })
    return () => { unsubscribe(); stop() }
  }, [])

  const startRecording = async () => {
    if (!enableVoiceInput || busy || !authSession.canRequest()) return
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: t('ChatInput.unsupportedVoiceTitle'), message: t('ChatInput.unsupportedVoiceMessage'), variant: 'error' })
      return
    }

    stopSeqRef.current += 1
    const seq = stopSeqRef.current
    const operation = begin()
    releaseOperationRef.current = operation.release
    const current = () => operation.current() && seq === stopSeqRef.current

    setIsRecording(true)
    setIsTranscribing(false)
    chunksRef.current = []
    mimeTypeRef.current = ''

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!current()) { stream.getTracks().forEach(track => track.stop()); operation.release(); return }
      streamRef.current = stream

      const mimeType = pickSupportedMimeType()
      mimeTypeRef.current = mimeType

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }

      recorder.onstop = async () => {
        if (!current()) { operation.release(); return }

        const chunks = chunksRef.current
        chunksRef.current = []
        setIsRecording(false)
        setIsTranscribing(true)

        try {
          const blobType = mimeTypeRef.current || (chunks[0] as Blob | undefined)?.type || 'audio/webm'
          const blob = new Blob(chunks, { type: blobType })
          const res = await apiTranscribeAudio(blob, 'zh', { signal: operation.signal })
          if (!current()) return
          onChange(res.text)
          textareaRef.current?.focus()
        } catch (err) {
          if (!current() || axios.isCancel(err)) return
          const msg = (err as Error).message || t('ChatInput.unknownError')
          toast({ title: t('ChatInput.transcribeFailureTitle'), message: msg, variant: 'error' })
        } finally {
          operation.release()
          if (current()) {
            cleanupStream()
            setIsTranscribing(false)
            mediaRecorderRef.current = null
            mimeTypeRef.current = ''
          }
        }
      }

      recorder.start(250)
    } catch (err) {
      operation.release()
      if (!current() || axios.isCancel(err)) return
      setIsRecording(false)
      cleanupStream()
      const msg = (err as Error).message || t('ChatInput.unknownError')
      toast({ title: t('ChatInput.startRecordFailureTitle'), message: msg, variant: 'error' })
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current) { stopSeqRef.current++; setIsRecording(false); return }
    if (mediaRecorderRef.current.state !== 'recording') return
    try {
      mediaRecorderRef.current.stop()
    } catch {
      // ignore
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!busy && value.trim() && authSession.canRequest()) onSend()
    }
  }

  const handleVoicePointerDown = async (e: PointerEvent<HTMLButtonElement>) => {
    if (!enableVoiceInput || busy || !authSession.canRequest()) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    await startRecording()
  }

  const handleVoicePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!enableVoiceInput) return
    e.preventDefault()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    stopRecording()
  }

  return {
    textareaRef,
    isRecording,
    isTranscribing,
    busy,
    handleKeyDown,
    handleVoicePointerDown,
    handleVoicePointerUp,
    stopRecording,
  }
}
