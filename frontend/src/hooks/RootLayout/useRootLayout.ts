import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'

export function useRootLayout() {
  const { user, logout, phase } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [navOpen, setNavOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const raw = localStorage.getItem('theme')
    if (raw === 'light' || raw === 'dark') return raw
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleNav = useCallback(() => {
    setNavOpen((v) => !v)
  }, [])

  const closeNav = useCallback(() => {
    setNavOpen(false)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    toast({
      title: t('RootLayout.themeChangedTitle'),
      message: theme === 'dark' ? t('RootLayout.themeChangedToLight') : t('RootLayout.themeChangedToDark'),
      variant: 'info',
    })
  }, [theme, toast])

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (error) {
      toast({ title: '退出结果未确认', message: (error as Error).message, variant: 'error' })
    }
  }

  return {
    user,
    logoutPending: phase === 'loggingOut',
    navOpen,
    theme,
    toggleNav,
    closeNav,
    toggleTheme,
    handleLogout,
  }
}
