import { Mic, SendHorizonal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatInput } from '@/hooks/ChatInput/useChatInput'
import { t } from '@/lib/i18n'

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
  placeholder = t('ChatInput.placeholder'),
  enableVoiceInput = false,
}: Props) {
  const {
    textareaRef,
    isRecording,
    isTranscribing,
    busy,
    handleKeyDown,
    handleVoicePointerDown,
    handleVoicePointerUp,
    stopRecording,
  } = useChatInput({ value, onChange, onSend, disabled, enableVoiceInput })

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
          title={isRecording ? t('ChatInput.recordingTitle') : t('ChatInput.startRecordTitle')}
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
