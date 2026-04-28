import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { Mic, SendHorizonal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { apiTranscribeAudio } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  placeholder?: string
  enableVoiceInput?: boolean
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = '输入消息…',
  enableVoiceInput = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeTypeRef = useRef<string>('')
  const stopSeqRef = useRef(0)

  const isVoiceBusy = isRecording || isTranscribing
  const busy = disabled || isVoiceBusy

  const pickSupportedMimeType = () => {
    const candidates = [
      // 优先尝试 OGG，很多环境下 AudioContext 对 ogg 更容易解码。
      // 若 ogg 不支持，则回退到 webm。
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
        // ignore
      }
      cleanupStream()
    }
  }, [])

  const startRecording = async () => {
    if (!enableVoiceInput || busy) return
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: '当前浏览器不支持语音输入', message: '请换浏览器或使用手动输入', variant: 'error' })
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
        // 防止并发 stop 导致的“旧录音覆盖新录音”。
        if (seq !== stopSeqRef.current) return

        const chunks = chunksRef.current
        chunksRef.current = []
        setIsRecording(false)
        setIsTranscribing(true)

        try {
          const blobType = mimeTypeRef.current || (chunks[0] as Blob | undefined)?.type || 'audio/webm'
          const blob = new Blob(chunks, { type: blobType })

          // 交给后端做 webm/ogg(opus) -> wav 转码，前端只负责采集并上传录音内容。
          const audioForStt: Blob | File = blob

          const res = await apiTranscribeAudio(audioForStt, 'zh')
          onChange(res.text)
          textareaRef.current?.focus()
        } catch (err) {
          const msg = (err as Error).message || '未知错误'
          toast({ title: '语音识别失败', message: msg, variant: 'error' })
        } finally {
          cleanupStream()
          setIsTranscribing(false)
          mediaRecorderRef.current = null
          mimeTypeRef.current = ''
        }
      }

      // 使用 timeslice 分段写入，减少某些浏览器下录音容器被截断的概率
      // 250ms 对实时性和稳定性折中
      recorder.start(250)
    } catch (err) {
      setIsRecording(false)
      cleanupStream()
      const msg = (err as Error).message || '未知错误'
      toast({ title: '无法开始录音', message: msg, variant: 'error' })
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return
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
      if (value.trim()) onSend()
    }
  }

  const handleVoicePointerDown = async (e: PointerEvent<HTMLButtonElement>) => {
    if (!enableVoiceInput || busy) return
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

  return (
    <div className="flex items-end gap-2">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={busy}
        placeholder={placeholder}
        rows={1}
        className="max-h-40 min-h-10 flex-1 resize-none"
      />

      {enableVoiceInput ? (
        <Button
          type="button"
          size="icon"
          variant={isRecording ? 'destructive' : 'outline'}
          onPointerDown={handleVoicePointerDown}
          onPointerUp={handleVoicePointerUp}
          onPointerCancel={stopRecording}
          disabled={disabled || isTranscribing}
          className="shrink-0"
          title={isRecording ? '松开结束并转写' : '按住说话'}
        >
          {isRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
        </Button>
      ) : null}

      <Button size="icon" onClick={onSend} disabled={busy || !value.trim()} className="shrink-0">
        <SendHorizonal className="size-4" />
      </Button>
    </div>
  )
}
