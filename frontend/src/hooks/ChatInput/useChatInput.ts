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
  // Prefer Opus containers that preserve speech quality at small sizes; the
  // backend still normalizes non-WAV input because browser support varies.
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeTypeRef = useRef('')
  // MediaRecorder.onstop may fire after a newer recording starts. Sequence IDs
  // prevent that stale callback from overwriting the newer input text.
  const stopSeqRef = useRef(0)

  const isVoiceBusy = isRecording || isTranscribing
  const busy = disabled || isVoiceBusy

  const cleanupStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
    }
    streamRef.current = null
  }

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop()
      } catch {
        // Recorder may already be inactive during unmount; tracks still need cleanup.
      }
      cleanupStream()
    }
  }, [])

  const startRecording = async () => {
    if (!enableVoiceInput || busy) return
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: t('ChatInput.unsupportedVoiceTitle'), message: t('ChatInput.unsupportedVoiceMessage'), variant: 'error' })
      return
    }

    stopSeqRef.current += 1
    const seq = stopSeqRef.current

    setIsRecording(true)
    setIsTranscribing(false)
    chunksRef.current = []
    mimeTypeRef.current = ''

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickSupportedMimeType()
      mimeTypeRef.current = mimeType

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) chunksRef.current.push(evt.data)
      }

      recorder.onstop = async () => {
        if (seq !== stopSeqRef.current) return

        const chunks = chunksRef.current
        chunksRef.current = []
        setIsRecording(false)
        setIsTranscribing(true)

        try {
          const blobType = mimeTypeRef.current || (chunks[0] as Blob | undefined)?.type || 'audio/webm'
          const blob = new Blob(chunks, { type: blobType })
          const res = await apiTranscribeAudio(blob, 'zh')
          onChange(res.text)
          textareaRef.current?.focus()
        } catch (err) {
          const msg = (err as Error).message || t('ChatInput.unknownError')
          toast({ title: t('ChatInput.transcribeFailureTitle'), message: msg, variant: 'error' })
        } finally {
          cleanupStream()
          setIsTranscribing(false)
          mediaRecorderRef.current = null
          mimeTypeRef.current = ''
        }
      }

      // Periodic chunks avoid one large in-memory allocation while keeping enough
      // data available if the browser dispatches the final stop event late.
      recorder.start(250)
    } catch (err) {
      setIsRecording(false)
      cleanupStream()
      const msg = (err as Error).message || t('ChatInput.unknownError')
      toast({ title: t('ChatInput.startRecordFailureTitle'), message: msg, variant: 'error' })
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return
    if (mediaRecorderRef.current.state !== 'recording') return
    try {
      mediaRecorderRef.current.stop()
    } catch {
      // Pointer-up and browser lifecycle events can race; stopping twice is harmless.
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim()) onSend()
    }
  }

  const handleVoicePointerDown = async (e: PointerEvent<HTMLButtonElement>) => {
    if (!enableVoiceInput || busy) return
    e.preventDefault()
    // Pointer capture guarantees release is observed even if the user drags
    // outside the microphone button while holding it.
    e.currentTarget.setPointerCapture(e.pointerId)
    await startRecording()
  }

  const handleVoicePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!enableVoiceInput) return
    e.preventDefault()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already be released by the browser after cancellation.
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
