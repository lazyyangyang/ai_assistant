import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Menu, Moon, Sun, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCallback, useEffect, useState } from 'react'

type NavItem = { to: string; label: string; end?: boolean }

const nav: NavItem[] = [
  { to: '/', label: '首页', end: true },
  { to: '/jd', label: 'JD 解析' },
  { to: '/resume', label: '简历' },
  { to: '/interview', label: '模拟面试' },
]

export function RootLayout() {
  const { user, logout } = useAuth()
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

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    toast({ title: '主题已切换', message: theme === 'dark' ? '已切换为浅色' : '已切换为深色', variant: 'info' })
  }, [theme, toast])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <NavLink
            to="/"
            end
            className="text-sm font-semibold tracking-tight text-primary"
          >
            AI Career
          </NavLink>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              aria-label="打开导航"
            >
              {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>

            <nav className="hidden flex-wrap gap-1 text-sm md:flex">
              {nav.map(({ to, label, end = false }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    [
                      'rounded-md px-3 py-1.5 transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    ].join(' ')
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
              {user ? (
                <>
                  <span className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground">
                    <User className="size-3.5" />
                    {user.username}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="h-8 gap-1 text-muted-foreground"
                  >
                    <LogOut className="size-3.5" />
                    退出
                  </Button>
                </>
              ) : (
                <>
                  <NavLink
                    to="/login"
                    className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    登录
                  </NavLink>
                  <NavLink to="/register">
                    <Button size="sm" className="h-8">
                      注册
                    </Button>
                  </NavLink>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="ml-2 hidden md:inline-flex"
              aria-label="切换深色模式"
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>

        {navOpen && (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3 md:hidden">
            <nav className="flex flex-wrap gap-1 text-sm">
              {nav.map(({ to, label, end = false }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) =>
                    [
                      'rounded-md px-3 py-1.5 transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    ].join(' ')
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
