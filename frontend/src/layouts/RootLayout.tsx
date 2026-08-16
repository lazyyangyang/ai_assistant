import { NavLink, Outlet } from 'react-router-dom'
import { LogOut, Menu, Moon, Sun, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRootLayout } from '@/hooks/RootLayout/useRootLayout'
import { t } from '@/lib/i18n'
import { preloadRoute } from '@/lib/lazyRoutes'

type NavItem = { to: string; label: string; end?: boolean }

const nav: NavItem[] = [
  { to: '/', label: t('RootLayout.navHome'), end: true },
  { to: '/jd', label: t('RootLayout.navJd') },
  { to: '/resume', label: t('RootLayout.navResume') },
  { to: '/interview', label: t('RootLayout.navInterview') },
]

export function RootLayout() {
  const { user, navOpen, theme, toggleNav, closeNav, toggleTheme, handleLogout } = useRootLayout()

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <NavLink
            to="/"
            end
            className="text-sm font-semibold tracking-tight text-primary"
          >
            {t('RootLayout.brand')}
          </NavLink>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleNav}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              aria-label={t('RootLayout.openNav')}
            >
              {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>

            <nav className="hidden flex-wrap gap-1 text-sm md:flex">
              {nav.map(({ to, label, end = false }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onMouseEnter={() => preloadRoute(to)}
                  onFocus={() => preloadRoute(to)}
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
                    {t('RootLayout.logout')}
                  </Button>
                </>
              ) : (
                <>
                  <NavLink
                    to="/login"
                    onMouseEnter={() => preloadRoute('/login')}
                    onFocus={() => preloadRoute('/login')}
                    className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {t('RootLayout.login')}
                  </NavLink>
                  <NavLink
                    to="/register"
                    onMouseEnter={() => preloadRoute('/register')}
                    onFocus={() => preloadRoute('/register')}
                  >
                    <Button size="sm" className="h-8">
                      {t('RootLayout.register')}
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
              aria-label={t('RootLayout.toggleTheme')}
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
                  onClick={closeNav}
                  onMouseEnter={() => preloadRoute(to)}
                  onFocus={() => preloadRoute(to)}
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
