import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { isValidElement, useState, type ReactNode } from 'react'
import { Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/types/chat'

interface Props {
  message: ChatMessage
}

function childrenToString(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToString).join('')
  if (isValidElement(children)) {
    const props = children as { props?: { children?: ReactNode } }
    return childrenToString(props.props?.children)
  }
  return ''
}

export function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleCopyCode = async (codeText: string) => {
    try {
      await navigator.clipboard.writeText(codeText)
      setCopiedCode(codeText)
      setTimeout(() => setCopiedCode((v) => (v === codeText ? null : v)), 1200)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}
    >
      <Avatar className="mt-0.5 size-8 shrink-0">
        <AvatarFallback
          className={cn(
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-violet-600 text-white',
          )}
        >
          {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div>
            <div className="mb-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? '已复制' : '一键复制重写内容'}
              </Button>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_code]:rounded [&_code]:bg-zinc-200 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs dark:[&_code]:bg-zinc-800 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                code(props: {
                  inline?: boolean
                  className?: string
                  children?: ReactNode
                }) {
                  const { inline, className, children } = props
                  const codeText = childrenToString(children).replace(/\n$/, '')
                  if (inline) {
                    return <code className={className}>{children}</code>
                  }

                  return (
                    <div className="relative">
                      <div className="mb-2 flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyCode(codeText)}
                          disabled={!codeText.trim()}
                        >
                          {copiedCode === codeText ? '已复制' : '复制代码'}
                        </Button>
                      </div>
                      <pre>
                        <code className={className}>{children}</code>
                      </pre>
                    </div>
                  )
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
