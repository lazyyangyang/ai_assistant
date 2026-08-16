import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RootLayout } from './layouts/RootLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Skeleton } from './components/ui/Skeleton'
import {
  LazyHomePage,
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
          <Route index element={<LazyHomePage />} />
          <Route path="login" element={<LazyLoginPage />} />
          <Route path="register" element={<LazyRegisterPage />} />
          <Route
            path="jd"
            element={
              <ProtectedRoute>
                <LazyJDPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="resume"
            element={
              <ProtectedRoute>
                <LazyResumePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="interview"
            element={
              <ProtectedRoute>
                <LazyInterviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="interview/end/:sessionId"
            element={
              <ProtectedRoute>
                <LazyInterviewEndPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
