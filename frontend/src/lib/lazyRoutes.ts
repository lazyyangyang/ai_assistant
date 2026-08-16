import { lazy } from 'react'

const pageLoaders = {
  home: () => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })),
  login: () => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
  register: () => import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
  jd: () => import('@/pages/JDPage').then((m) => ({ default: m.JDPage })),
  resume: () => import('@/pages/ResumePage').then((m) => ({ default: m.ResumePage })),
  interview: () => import('@/pages/InterviewPage').then((m) => ({ default: m.InterviewPage })),
  interviewEnd: () =>
    import('@/pages/InterviewEndPage').then((m) => ({ default: m.InterviewEndPage })),
} as const

const pathToLoader: Record<string, keyof typeof pageLoaders> = {
  '/': 'home',
  '/login': 'login',
  '/register': 'register',
  '/jd': 'jd',
  '/resume': 'resume',
  '/interview': 'interview',
}

export const LazyHomePage = lazy(pageLoaders.home)
export const LazyLoginPage = lazy(pageLoaders.login)
export const LazyRegisterPage = lazy(pageLoaders.register)
export const LazyJDPage = lazy(pageLoaders.jd)
export const LazyResumePage = lazy(pageLoaders.resume)
export const LazyInterviewPage = lazy(pageLoaders.interview)
export const LazyInterviewEndPage = lazy(pageLoaders.interviewEnd)

export function preloadRoute(path: string) {
  const loaderKey = pathToLoader[path]
  if (!loaderKey) return
  void pageLoaders[loaderKey]()
}
