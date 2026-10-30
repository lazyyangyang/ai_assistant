import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
export async function account(request: APIRequestContext) {
  const username = `test_${randomUUID().replaceAll('-', '')}`
  const user = { username, email: `${username}@example.com`, password: 'test-password-123' }
  const response = await request.post('/api/auth/register', { data: user, headers: { 'X-CSRF-Protection': '1' } })
  expect(response.status()).toBe(201)
  return user
}
export async function login(page: Page, user: Awaited<ReturnType<typeof account>>, navigate = true) {
  if (navigate) await page.goto('/login')
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login'))
  await page.locator('button[type=submit]').click()
  const data = await (await response).json()
  expect(typeof data.session_id).toBe('string')
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
  return data as { session_id: string; access_token: string }
}
export async function resumePage(page: Page) {
  await page.locator('a[href="/resume"]').first().click()
  await expect(page.locator('input[type=file]')).toBeVisible()
}
export async function upload(page: Page, name: string) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/resumes/upload'))
  await page.locator('input[type=file]').setInputFiles({ name: `${name}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`${name} resume React developer`) })
  await page.getByRole('button', { name: '上传简历', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(201)
  return await result.json() as { id: string }
}
