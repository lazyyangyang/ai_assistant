import { createContext, useEffect, useState, type ReactNode } from 'react'
import { ResumeStore } from '@/lib/resumeStore'
// eslint-disable-next-line react-refresh/only-export-components
export const ResumeDataContext = createContext<ResumeStore | null>(null)
export function ResumeDataProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ResumeStore())
  useEffect(() => store.start(), [store])
  return <ResumeDataContext.Provider value={store}>{children}</ResumeDataContext.Provider>
}
