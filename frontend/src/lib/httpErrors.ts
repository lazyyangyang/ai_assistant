import axios from 'axios'
export async function normalizeHttpError(error: unknown): Promise<never> {
  if (!axios.isAxiosError(error) || axios.isCancel(error)) throw error
  let body: unknown = error.response?.data
  try {
    if (body instanceof Blob) body = JSON.parse(await body.text())
    else if (body instanceof ReadableStream) body = await new Response(body).json()
  } catch { /* Preserve HTTP status for non-JSON errors. */ }
  const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
  if (typeof detail === 'string') error.message = detail
  else if (Array.isArray(detail)) error.message = detail.map(item => item?.msg ?? '请求参数错误').join('；')
  else if (error.response) error.message = `HTTP ${error.response.status}`
  throw error
}
