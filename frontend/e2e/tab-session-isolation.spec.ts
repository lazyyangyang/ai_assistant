import { test, expect } from '@playwright/test'
import { account, login, resumePage, upload } from './fixtures/accounts'

test('T01–T04 T07 T11 T12 T14 real protocol: different accounts and targeted logout', async ({ page, context, request, browser }) => {
  console.log(`Browser: ${browser.browserType().name()} ${browser.version()}`)
  expect((await (await request.get('/api/e2e/isolation')).json()).external_services).toBe('fixtures')
  const a = await account(request), b = await account(request)
  const first = await login(page, a)
  const secondPage = await context.newPage()
  const second = await login(secondPage, b)
  expect(first.session_id === second.session_id).toBe(false)
  await resumePage(page); await resumePage(secondPage)
  const resume = await upload(page, 'ACCOUNT_A'); await upload(secondPage, 'ACCOUNT_B')
  expect((await request.get(`/api/resumes/${resume.id}`, { headers: { Authorization: `Bearer ${second.access_token}` } })).status()).toBe(404)
  await expect(page.getByText('ACCOUNT_A.txt（v1）', { exact: false })).toBeVisible()
  await expect(page.getByText('ACCOUNT_B.txt', { exact: false })).toHaveCount(0)
  const cookies = await context.cookies()
  const wrong = cookies.find(c => c.path === `/api/auth/sessions/${second.session_id}/`)!
  for (const action of ['refresh', 'logout']) {
    expect((await request.post(`/api/auth/sessions/${first.session_id}/${action}`, {
      headers: { 'X-CSRF-Protection': '1', Cookie: `ai_career_tab_refresh=${wrong.value}` },
    })).status()).toBe(401)
  }
  const paths = cookies.filter(c => c.name === 'ai_career_tab_refresh').map(c => c.path)
  expect(paths.sort()).toEqual([first, second].map(s => `/api/auth/sessions/${s.session_id}/`).sort())
  for (const s of [first, second]) {
    const response = await context.request.post(`/api/auth/sessions/${s.session_id}/refresh`, { headers: { 'X-CSRF-Protection': '1' } })
    expect(response.status()).toBe(200)
    expect((await response.json()).session_id === s.session_id).toBe(true)
    expect(response.headers()['set-cookie']).toBeUndefined()
  }
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect((await context.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${first.access_token}` } })).status()).toBe(401)
  expect((await context.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${second.access_token}` } })).status()).toBe(200)
  expect((await context.request.post(`/api/auth/sessions/${first.session_id}/logout`, { headers: { 'X-CSRF-Protection': '1' } })).status()).toBe(204)
  expect((await context.request.post('/api/auth/refresh')).status()).toBe(410)
  expect((await context.request.post(`/api/auth/sessions/${second.session_id}/refresh`)).status()).toBe(403)
  await expect(secondPage.getByText(b.username, { exact: true })).toBeVisible()
})

test('T04–T06 new page stays anonymous; reload restores only this tab', async ({ page, context, request }) => {
  const user = await account(request)
  const first = await login(page, user)
  const second = await context.newPage()
  let refreshes = 0
  second.on('request', r => { if (r.url().endsWith('/refresh')) refreshes++ })
  await second.goto('/resume'); await expect(second).toHaveURL(/\/login$/)
  expect(refreshes).toBe(0)
  const login2 = await login(second, user)
  expect(first.session_id === login2.session_id).toBe(false)
  await resumePage(page)
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
  const restored = page.waitForResponse(r => r.url().endsWith(`/sessions/${first.session_id}/refresh`))
  await page.reload()
  expect((await restored).status()).toBe(200)
  await expect(page).toHaveURL(/\/resume$/)
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.reload()
  await expect(page.locator('#email')).toBeVisible()
  await expect(second.getByText(user.username, { exact: true })).toBeVisible()
})

test('reload independently restores two accounts without storing access tokens', async ({ page, context, request }) => {
  const a = await account(request), b = await account(request), other = await context.newPage()
  const first = await login(page, a), second = await login(other, b)
  await resumePage(page); await resumePage(other)
  for (const [current, identity, user] of [[page, first, a], [other, second, b]] as const) {
    const response = current.waitForResponse(r => r.url().endsWith(`/sessions/${identity.session_id}/refresh`))
    await current.reload()
    expect((await (await response).json()).session_id).toBe(identity.session_id)
    await expect(current.getByText(user.username, { exact: true })).toBeVisible()
    const storage = await current.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))
    expect(storage.session).toEqual({ 'ai-career-session-id-v1': identity.session_id })
    expect(JSON.stringify(storage)).not.toContain(identity.access_token)
    expect(JSON.stringify(storage.local)).not.toContain(identity.session_id)
  }
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await other.reload()
  await expect(other.getByText(b.username, { exact: true })).toBeVisible()
})

test('opener storage copy cannot inherit a login, even after reloading the new page', async ({ page, request }) => {
  const a = await account(request)
  await login(page, a)
  const popupEvent = page.waitForEvent('popup')
  await page.evaluate(() => window.open('/resume', '_blank'))
  const popup = await popupEvent
  await expect(popup).toHaveURL(/\/login$/)
  expect(await popup.evaluate(() => sessionStorage.getItem('ai-career-session-id-v1'))).toBeNull()
  await popup.reload()
  await expect(popup.locator('#email')).toBeVisible()
  await expect(page.getByText(a.username, { exact: true })).toBeVisible()
})

test('recovery outage retries and a revoked session returns to login', async ({ page, context, request }) => {
  const a = await account(request), identity = await login(page, a)
  await resumePage(page)
  await page.route('**/api/auth/sessions/*/refresh', route => route.fulfill({ status: 503, json: { detail: 'temporary outage' } }))
  await page.reload()
  await expect(page.getByRole('dialog', { name: '恢复登录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试恢复', exact: true })).toBeEnabled()
  await page.unroute('**/api/auth/sessions/*/refresh')
  await page.getByRole('button', { name: '重试恢复', exact: true }).click()
  await expect(page.getByText(a.username, { exact: true })).toBeVisible()
  expect((await context.request.post(`/api/auth/sessions/${identity.session_id}/logout`, { headers: { 'X-CSRF-Protection': '1' } })).status()).toBe(204)
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => sessionStorage.getItem('ai-career-session-id-v1'))).toBeNull()
})

test('T09 T13 injected logout failure preserves draft until explicit revalidation', async ({ page, request }) => {
  const user = await account(request); await login(page, user); await resumePage(page)
  await page.getByPlaceholder('简历标题（可选）').fill('unsaved draft')
  await page.route('**/api/auth/sessions/*/logout', route => route.fulfill({ status: 503, json: { detail: 'injected failure' } }))
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '认证状态' })).toBeVisible()
  await expect(page.getByPlaceholder('简历标题（可选）')).toHaveValue('unsaved draft')
  await page.getByRole('button', { name: '验证后继续' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByPlaceholder('简历标题（可选）')).toHaveValue('unsaved draft')
})


test('T08 injected business 401 triggers one real targeted refresh per page', async ({ page, context, request }) => {
  const user = await account(request), second = await context.newPage()
  const one = await login(page, user), two = await login(second, user)
  for (const [current, identity] of [[page, one], [second, two]] as const) {
    let refreshes = 0, reject = true
    current.on('request', r => {
      if (r.url().endsWith('/refresh')) {
        refreshes++
        expect(r.url().endsWith(`/sessions/${identity.session_id}/refresh`)).toBe(true)
      }
    })
    await current.route('**/api/resumes', route => {
      if (reject) { reject = false; return route.fulfill({ status: 401, json: { detail: 'injected expired access' } }) }
      return route.continue()
    })
    await resumePage(current)
    await expect.poll(() => refreshes).toBe(1)
    await expect(current.getByText(user.username, { exact: true })).toBeVisible()
  }
})

test('T10 JD stays in this document and is cleared on same-page account replacement', async ({ page, context, request }) => {
  // Three real logins and three persisted SSE exchanges exceed the short smoke budget on WebKit.
  test.setTimeout(60_000)
  const user = await account(request), second = await context.newPage()
  await login(page, user); await login(second, user)
  await page.locator('a[href="/jd"]').first().click()
  await page.locator('textarea').fill('React developer JD')
  await page.locator('textarea').press('Enter')
  await page.getByRole('button', { name: '保存结果', exact: true }).click()
  await expect(page.getByText('已保存到本标签页当前会话：', { exact: false })).toBeVisible()
  for (const [current, saved] of [[page, true], [second, false]] as const) {
    await resumePage(current)
    const sent = current.waitForRequest(r => r.url().endsWith('/api/chat/stream'))
    await current.locator('textarea').fill('diagnose this text')
    await current.locator('textarea').press('Enter')
    expect(Boolean((await sent).postDataJSON().jd_context)).toBe(saved)
    await expect(current.locator('textarea')).toBeEnabled()
  }
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, user, false); await resumePage(page)
  const sent = page.waitForRequest(r => r.url().endsWith('/api/chat/stream'))
  await page.locator('textarea').fill('new session')
  await page.locator('textarea').press('Enter')
  expect(Boolean((await sent).postDataJSON().jd_context)).toBe(false)
})

test('T09 T22 delayed old list cannot update a new same-document identity', async ({ page, request }) => {
  const a = await account(request), b = await account(request)
  await login(page, a)
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  let once = true
  await page.route('**/api/resumes', async route => {
    if (!once) return route.continue()
    once = false
    const response = await route.fetch()
    started(); await held
    await route.fulfill({ response }).catch(() => {})
  })
  await resumePage(page); await ready
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, b, false); await resumePage(page)
  release()
  await expect(page.getByText(b.username, { exact: true })).toBeVisible()
  await expect(page.getByText('还没有上传简历', { exact: true })).toBeVisible()
  await expect(page.getByText(a.username, { exact: true })).toHaveCount(0)
})
