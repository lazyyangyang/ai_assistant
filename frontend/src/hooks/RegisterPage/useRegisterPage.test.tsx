import { act, renderHook } from '@testing-library/react'
import type { FormEvent } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useRegisterPage } from './useRegisterPage'

const { register, navigate, toast } = vi.hoisted(() => ({
  register: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ register }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ toast }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

beforeEach(() => vi.resetAllMocks())

it('redirects to login only after registration succeeds and asks the user to log in', async () => {
  let resolve!: () => void
  register.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  const { result } = renderHook(useRegisterPage)
  act(() => {
    result.current.setUsername('new-user')
    result.current.setEmail('new@example.com')
    result.current.setPassword('password123')
  })
  let pending!: Promise<void>
  act(() => { pending = result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as FormEvent) })
  expect(result.current.loading).toBe(true)
  expect(navigate).not.toHaveBeenCalled()
  await act(async () => { resolve(); await pending })
  expect(register).toHaveBeenCalledWith('new-user', 'new@example.com', 'password123')
  expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: '账号已创建，请登录', variant: 'success' }))
  expect(result.current.loading).toBe(false)
})

it('keeps the registration page and displays the error if registration fails', async () => {
  register.mockRejectedValue(new Error('该邮箱或用户名已被注册'))
  const { result } = renderHook(useRegisterPage)
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as FormEvent)
  })
  expect(navigate).not.toHaveBeenCalled()
  expect(result.current.error).toBe('该邮箱或用户名已被注册')
  expect(result.current.loading).toBe(false)
})
