import { CareerTrack } from '@/components/CareerTrack'
import { useAuth } from '@/contexts/AuthContext'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRegisterPage } from '@/hooks/RegisterPage/useRegisterPage'
import { t } from '@/lib/i18n'

export function RegisterPage() {
  const {
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    handleSubmit,
  } = useRegisterPage()

  const { sessionId, logout } = useAuth()
  if (sessionId) return <div>当前标签页已有登录会话。<button onClick={() => void logout().catch(() => {})}>退出本页后注册</button></div>
  return (
    <div className="space-y-10">
      <div className="flex items-center justify-center px-4 pt-4 sm:pt-8">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t('RegisterPage.title')}</CardTitle>
            <CardDescription>{t('RegisterPage.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="username">{t('RegisterPage.usernameLabel')}</Label>
                <Input
                  id="username"
                  required
                  minLength={2}
                  placeholder={t('RegisterPage.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('RegisterPage.emailLabel')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('RegisterPage.passwordLabel')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  placeholder={t('RegisterPage.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('RegisterPage.submitLoading') : t('RegisterPage.submit')}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {t('RegisterPage.loginPrompt')}{' '}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                {t('RegisterPage.loginLink')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
      <CareerTrack />
    </div>
  )
}
