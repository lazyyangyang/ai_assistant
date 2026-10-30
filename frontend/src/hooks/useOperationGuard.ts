import { useCallback, useEffect, useRef } from 'react'
import { authSession } from '@/lib/authSession'
import { createRequestScope } from '@/lib/requestScope'
/** Captures both component lifetime and the precise authentication generation. */
export function useOperationGuard() {
  const alive = useRef(true)
  const operations = useRef(new Set<AbortController>())
  useEffect(() => {
    alive.current = true
    const currentOperations = operations.current
    return () => { alive.current = false; currentOperations.forEach(c => c.abort()); currentOperations.clear() }
  }, [])
  const begin = useCallback(() => {
    const identity = authSession.captureIdentity()
    const local = new AbortController()
    operations.current.add(local)
    const scope = createRequestScope(local.signal)
    return { signal: scope.signal,
      current: () => alive.current && authSession.isCurrent(identity) && !scope.signal.aborted,
      release: () => { scope.release(); operations.current.delete(local) },
    }
  }, [])
  return begin
}
