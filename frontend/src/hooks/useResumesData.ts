import { useContext, useEffect, useSyncExternalStore } from 'react'
import { ResumeDataContext } from '@/contexts/ResumeDataContext'
export function useResumesData() {
  const store = useContext(ResumeDataContext)
  if (!store) throw new Error('ResumeDataProvider is required')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.consume(), [store])
  return { ...snapshot, refresh: store.refresh }
}
