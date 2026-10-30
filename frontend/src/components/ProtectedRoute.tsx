import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/Skeleton'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, phase } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-80" />
      </div>
    )
  }

  if (phase === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!user) return null
  return <>{children}</>
}
