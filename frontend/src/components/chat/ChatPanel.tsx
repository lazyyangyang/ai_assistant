import { Square } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { ChatInput } from './ChatInput'
import { ChatMessageBubble } from './ChatMessageBubble'
import { type ChatPanelProps, useChatPanel } from '@/hooks/ChatPanel/useChatPanel'
import { t } from '@/lib/i18n'

export function ChatPanel({
  title,
  agentType,
  systemGreeting,
  selectedResumeId,
  selectedJdContext,
  onStructuredData,
  onLatestAssistantMessageChange,
  enableVoiceOutput = false,
  autoPlayVoiceOutput = true,
}: ChatPanelProps) {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    messages,
    isLoading,
    input,
    setInput,
    latestAssistantMessage,
    audioRef,
    ttsAudioUrl,
    ttsIsGenerating,
    viewportRef,
    virtualizer,
    isSessionCompleted,
    handleSend,
    handleNewChat,
    handleEndInterview,
    handleStopGeneration,
    handlePlayVoice,
  } = useChatPanel({
    title,
    agentType,
    systemGreeting,
    selectedResumeId,
    selectedJdContext,
    onStructuredData,
    onLatestAssistantMessageChange,
    enableVoiceOutput,
    autoPlayVoiceOutput,
  })

  return (
    <div className="flex h-[calc(100svh-8rem)] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <aside className="hidden w-64 shrink-0 border-r border-border md:flex md:flex-col">
        <div className="space-y-2 p-3">
          <Button className="w-full" variant="outline" onClick={handleNewChat}>
            {t('ChatPanel.newChat')}
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1 px-2 py-2">
          <div className="space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                className={[
                  'w-full rounded-md px-3 py-2 text-left text-sm transition',
                  activeSessionId === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                ].join(' ')}
              >
                <p className="line-clamp-1 font-medium">{session.title || t('ChatPanel.defaultSessionTitle')}</p>
                <p className="mt-1 text-xs opacity-80">
                  {new Date(session.updatedAt).toLocaleString()}
                </p>
              </button>
            ))}
            {!sessions.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">{t('ChatPanel.emptySessions')}</p>
            )}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-base font-medium">{title}</h2>
        </div>
        <Separator />

        <ScrollArea className="min-h-0 flex-1 px-4 py-4" viewportRef={viewportRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index
              const msg = messages[index]
              const isLastLoadingRow = isLoading && index === messages.length

              return (
                <div
                  key={isLastLoadingRow ? 'loading' : msg.id}
                  ref={virtualizer.measureElement}
                  data-index={index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: 16,
                  }}
                >
                  {msg ? (
                    <ChatMessageBubble message={msg} />
                  ) : isLastLoadingRow ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex gap-0.5">
                        <span className="animate-bounce">·</span>
                        <span className="animate-bounce [animation-delay:0.15s]">·</span>
                        <span className="animate-bounce [animation-delay:0.3s]">·</span>
                      </span>
                      {t('ChatPanel.loadingThinking')}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex items-end gap-2 px-4 py-3">
          <div className="flex-1">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => {
                handleSend().catch(() => {})
              }}
              enableVoiceInput={agentType === 'interview'}
              disabled={isLoading || isSessionCompleted}
            />
          </div>

          {agentType === 'interview' && enableVoiceOutput && latestAssistantMessage ? (
            <div className="flex items-end gap-2">
              <audio ref={audioRef} src={ttsAudioUrl ?? undefined} preload="none" />
              <Button
                variant="outline"
                onClick={() => {
                  handlePlayVoice()
                }}
              disabled={isLoading || ttsIsGenerating || !latestAssistantMessage.content.trim()}
                className="shrink-0"
              >
                {ttsIsGenerating ? t('ChatPanel.generatingVoice') : t('ChatPanel.playVoice')}
              </Button>
            </div>
          ) : null}

          {agentType === 'interview' && activeSessionId && !isSessionCompleted && (
            <Button
              variant="outline"
              onClick={() => {
                handleEndInterview().catch(() => {})
              }}
              disabled={isLoading}
              className="shrink-0"
            >
              {t('ChatPanel.endInterview')}
            </Button>
          )}
          {isLoading && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleStopGeneration}
              title={t('ChatPanel.stopGenerationTitle')}
              className="shrink-0"
            >
              <Square className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
