import { Link } from 'react-router-dom'
import { FileSearch, FileText, Mic } from 'lucide-react'
import { t } from '@/lib/i18n'
import { preloadRoute } from '@/lib/lazyRoutes'

const features = [
  {
    to: '/jd',
    icon: FileSearch,
    title: t('HomePage.jdTitle'),
    desc: t('HomePage.jdDescription'),
  },
  {
    to: '/resume',
    icon: FileText,
    title: t('HomePage.resumeTitle'),
    desc: t('HomePage.resumeDescription'),
  },
  {
    to: '/interview',
    icon: Mic,
    title: t('HomePage.interviewTitle'),
    desc: t('HomePage.interviewDescription'),
  },
] as const

export function HomePage() {
  return (
    <div className="flex flex-col items-center space-y-10 pt-8">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          {t('HomePage.title')}
        </h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          {t('HomePage.description')}
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {features.map(({ to, icon: Icon, title, desc }) => (
          <Link
            key={to}
            to={to}
            onMouseEnter={() => preloadRoute(to)}
            onFocus={() => preloadRoute(to)}
            className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="size-5" />
            </div>
            <div className="text-center">
              <div className="font-medium">{title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
