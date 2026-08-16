import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatMessageBubble } from './ChatMessageBubble'
import { t } from '@/lib/i18n'

describe('ChatMessageBubble', () => {
  it('should render code block copy button and copy code', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const user = userEvent.setup()

    render(
      <ChatMessageBubble
        message={{
          id: '1',
          role: 'assistant',
          content: 'here is code:\n\n```ts\nconst x = 1\n```',
          createdAt: Date.now(),
        }}
      />,
    )

    const copyButton = screen.getByRole('button', { name: t('ChatMessageBubble.copyCode') })
    expect(copyButton).not.toBeDisabled()
    await user.click(copyButton)

    expect(await screen.findByRole('button', { name: t('ChatMessageBubble.copied') })).toBeInTheDocument()
  })
})

