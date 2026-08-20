import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  apiGetMe,
  apiLogin,
  apiLogout,
  apiRefreshAccessToken,
  apiRegister,
  clearAccessToken,
  setAccessToken,
  setAuthFailureHandler,
  type UserInfo,
} from '@/lib/api'
import { resetChatStore } from '@/stores/chatStore'

interface AuthState {
  user: UserInfo | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const clearSession = useCallback(() => {
    // 用户身份与聊天内存必须一起清理，防止下一位登录用户看到上一位用户的会话快照。
    resetChatStore()
    clearAccessToken()
    setUser(null)
  }, [])

  useEffect(() => {
    // API 层只报告“鉴权已不可恢复”，由 Context 统一决定清理用户和业务状态。
    setAuthFailureHandler(clearSession)
    return () => setAuthFailureHandler(null)
  }, [clearSession])

  useEffect(() => {
    let cancelled = false

    const restoreSession = async () => {
      // Access Token 不持久化，所以首屏先用 HttpOnly Cookie 换取新 token，再读取用户资料。
      const refreshed = await apiRefreshAccessToken()
      if (!refreshed) return

      try {
        const me = await apiGetMe()
        if (!cancelled) setUser(me)
      } catch {
        if (!cancelled) clearSession()
      }
    }

    restoreSession().finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      // StrictMode 或路由卸载后忽略旧请求，避免对已卸载 Provider 写状态。
      cancelled = true
    }
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password)
    setAccessToken(res.access_token)
    const me = await apiGetMe()
    setUser(me)
  }, [])

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const res = await apiRegister(username, email, password)
      setAccessToken(res.access_token)
      const me = await apiGetMe()
      setUser(me)
    },
    [],
  )

  const logout = useCallback(async () => {
    setUser(null)
    // 先清本地状态保证 UI 立即退出，再尽力让服务端清除 Refresh Cookie。
    resetChatStore()
    try {
      await apiLogout()
    } finally {
      clearAccessToken()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
