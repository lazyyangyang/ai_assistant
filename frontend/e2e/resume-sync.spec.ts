import { test, expect } from '@playwright/test'
import { account, login, resumePage, upload } from './fixtures/accounts'

test('T16 T18 T19 same-account writes synchronize without changing drafts or identity', async ({ page, context, request }) => {
  const user = await account(request), second = await context.newPage()
  await login(page, user); await login(second, user)
  await resumePage(page); await resumePage(second)
  await page.getByPlaceholder('简历标题（可选）').fill('keep this draft')
  await upload(second, 'SHARED_RESUME')
  await expect(page.getByText('SHARED_RESUME.txt', { exact: false }).first()).toBeVisible()
  await expect(page.getByPlaceholder('简历标题（可选）')).toHaveValue('keep this draft')
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
  await second.route('**/api/resumes', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 500, json: { detail: 'injected list failure' } }) : route.continue())
  let uploads = 0
  second.on('request', r => { if (r.url().endsWith('/resumes/upload')) uploads++ })
  await upload(second, 'COMMITTED')
  await expect(second.getByText('列表同步失败', { exact: false })).toBeVisible()
  await expect(page.getByText('COMMITTED.txt', { exact: false }).first()).toBeVisible()
  expect(uploads).toBe(1)
})


test('T18 selected deletion blocks new chat requests while preserving the draft', async ({ page, context, request }) => {
  const user = await account(request), second = await context.newPage()
  await login(page, user); await login(second, user)
  await resumePage(page); await upload(page, 'DELETE_ME')
  await page.getByRole('button', { name: /DELETE_ME.txt/ }).click()
  await page.locator('textarea').fill('start conversation')
  await page.locator('textarea').press('Enter')
  await expect(page.getByText('你好，这是隔离测试回答。', { exact: false }).first()).toBeVisible()
  await page.locator('textarea').fill('keep draft')
  await resumePage(second)
  await expect(second.getByRole('button', { name: '删除', exact: true })).toBeVisible()
  await second.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByText('当前会话的简历已删除。', { exact: false })).toBeVisible()
  await expect(page.locator('textarea')).toHaveValue('keep draft')
  await expect(page.locator('textarea')).toBeDisabled()
})

test('T19 notification failure cannot turn a committed write into failure', async ({ page, request }) => {
  const user = await account(request)
  await page.addInitScript(() => {
    BroadcastChannel.prototype.postMessage = () => { throw new Error('injected unavailable channel') }
  })
  await login(page, user); await resumePage(page); await upload(page, 'LOCAL_SUCCESS')
  await expect(page.getByText('LOCAL_SUCCESS.txt', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('上传失败', { exact: true })).toHaveCount(0)
})
