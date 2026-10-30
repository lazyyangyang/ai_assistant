import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RootLayout } from './layouts/RootLayout'
import { AuthenticatedWorkspace } from './components/AuthenticatedWorkspace'
import { Skeleton } from './components/ui/Skeleton'
import { HomePage } from './pages/HomePage'
import {
  LazyInterviewEndPage,
  LazyInterviewPage,
  LazyJDPage,
  LazyLoginPage,
  LazyRegisterPage,
  LazyResumePage,
} from './lib/lazyRoutes'

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-4 w-80" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LazyLoginPage />} />
          <Route path="register" element={<LazyRegisterPage />} />
          <Route element={<AuthenticatedWorkspace />}>
            <Route path="jd" element={<LazyJDPage />} />
            <Route path="resume" element={<LazyResumePage />} />
            <Route path="interview" element={<LazyInterviewPage />} />
            <Route path="interview/end/:sessionId" element={<LazyInterviewEndPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
