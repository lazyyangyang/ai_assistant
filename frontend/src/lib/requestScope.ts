const controllers = new Set<AbortController>()
export function createRequestScope(signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  controllers.add(controller)
  return { signal: controller.signal, release: () => {
    controllers.delete(controller)
    signal?.removeEventListener('abort', abort)
  } }
}
export function cancelRequests() {
  controllers.forEach(controller => controller.abort())
  controllers.clear()
}
