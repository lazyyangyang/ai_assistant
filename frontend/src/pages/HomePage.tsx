import { Link } from 'react-router-dom'
import { FileSearch, FileText, Mic } from 'lucide-react'

const features = [
  {
    to: '/jd',
    icon: FileSearch,
    title: 'JD 智能解析',
    desc: '粘贴岗位描述，AI 提取关键技能与要求',
  },
  {
    to: '/resume',
    icon: FileText,
    title: '简历诊断与重写',
    desc: '深度诊断简历短板，给出修改建议',
  },
  {
    to: '/interview',
    icon: Mic,
    title: '模拟面试',
    desc: '沉浸式多轮面试，AI 实时追问',
  },
] as const

export function HomePage() {
  return (
    <div className="flex flex-col items-center space-y-10 pt-8">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          AI 求职辅助平台
        </h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          基于大语言模型的全链路求职助手 — JD 解析、简历诊断、模拟面试，一站搞定。
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {features.map(({ to, icon: Icon, title, desc }) => (
          <Link
            key={to}
            to={to}
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
