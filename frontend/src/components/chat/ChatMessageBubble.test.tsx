import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatMessageBubble } from './ChatMessageBubble'

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

    const copyButton = screen.getByRole('button', { name: '复制代码' })
    expect(copyButton).not.toBeDisabled()
    await user.click(copyButton)

    // 成功复制后按钮文案会变为「已复制」。
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
  })
})

