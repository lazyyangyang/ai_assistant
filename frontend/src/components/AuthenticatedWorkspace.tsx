import { Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ResumeDataProvider } from '@/contexts/ResumeDataContext'
import { ProtectedRoute } from './ProtectedRoute'
export function AuthenticatedWorkspace() {
  const { sessionId, canSubmit } = useAuth()
  return <ProtectedRoute><ResumeDataProvider key={sessionId}>
    <div inert={!canSubmit} aria-busy={!canSubmit}><Outlet /></div>
  </ResumeDataProvider></ProtectedRoute>
}
