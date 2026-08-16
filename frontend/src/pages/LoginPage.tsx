import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLoginPage } from '@/hooks/LoginPage/useLoginPage'
import { t } from '@/lib/i18n'

export function LoginPage() {
  const { email, setEmail, password, setPassword, error, loading, handleSubmit } = useLoginPage()

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t('LoginPage.title')}</CardTitle>
          <CardDescription>{t('LoginPage.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t('LoginPage.emailLabel')}</Label>
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
              <Label htmlFor="password">{t('LoginPage.passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                placeholder={t('LoginPage.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('LoginPage.submitLoading') : t('LoginPage.submit')}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('LoginPage.registerPrompt')}{' '}
            <Link to="/register" className="text-primary underline-offset-4 hover:underline">
              {t('LoginPage.registerLink')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
