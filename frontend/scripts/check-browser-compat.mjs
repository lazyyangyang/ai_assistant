import { build, preview } from 'vite'
import { chromium, firefox, webkit, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('test-results/browser-compat')
await mkdir(out, { recursive: true })
await build({ build: { outDir: path.join(out, 'dist'), emptyOutDir: true } })
const server = await preview({ build: { outDir: path.join(out, 'dist') }, preview: { host: '127.0.0.1', port: 0, open: false } })
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const results = []
try {
  for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome' }], ['edge', chromium, { channel: 'msedge' }], ['firefox', firefox, {}], ['webkit', webkit, {}]]) {
    if (process.env.COMPAT_ENGINE && process.env.COMPAT_ENGINE !== name) continue
    let browser
    try {
      browser = await engine.launch({ headless: true, ...options })
      for (const width of [1365, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        const page = await context.newPage()
        page.setDefaultTimeout(7000)
        const row = { engine: name, version: browser.version(), width, checks: [], errors: [], unexpectedApi: [] }
        results.push(row)
        page.on('pageerror', e => row.errors.push(e.message))
        page.on('crash', () => row.errors.push('PAGE CRASH'))
        const user = { id: 'compat-user', username: 'compat-user', email: 'compat@example.com' }
        const token = { access_token: `e30.${Buffer.from(JSON.stringify({ sub: user.id, sid: '0123456789abcdef0123456789abcdef', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.test`, session_id: '0123456789abcdef0123456789abcdef', token_type: 'bearer', expires_in: 3600 }
        await page.route('**/api/**', async route => {
          const url = new URL(route.request().url()).pathname
          let body
          if (url === '/api/auth/login' || url.endsWith('/refresh')) body = token
          else if (url === '/api/auth/me' || url === '/api/auth/register') body = user
          else if (url === '/api/resumes' || url === '/api/chat/sessions') body = []
          else { row.unexpectedApi.push(url); return route.fulfill({ status: 503, json: { detail: 'compatibility fixture: unsupported endpoint' } }) }
          await route.fulfill({ status: 200, json: body })
        })
        const check = async (label, action) => {
          try { await action(); row.checks.push({ label, pass: true }) }
          catch (e) { row.checks.push({ label, pass: false, error: e.message.slice(0,700) }) }
        }
        const layout = async label => {
          await expect(page.locator('main')).toBeVisible()
          const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, text: document.querySelector('main')?.textContent?.trim().length }))
          if (metrics.overflow > 1 || !metrics.text) throw new Error(JSON.stringify(metrics))
          await page.screenshot({ path: path.join(out, `${name}-${width}-${label}.png`), fullPage: true })
        }
        for (const route of ['/', '/login', '/register']) await check(`public ${route}`, async () => {
          await page.goto(base + route)
          await expect(page.locator('.career-track')).toBeVisible()
          await layout(route === '/' ? 'home' : route.slice(1))
        })
        await page.goto(base)
        await check('dark theme layout', async () => {
          if(width >= 768) await page.getByRole('button', { name: '切换深色模式' }).click()
          else await page.evaluate(() => document.documentElement.classList.add('dark'))
          await layout('dark')
          await page.evaluate(() => document.documentElement.classList.remove('dark'))
        })
        row.capabilities = await page.evaluate(() => ({ pathCSS: CSS.supports('d', 'path("M0 0 L10 10")'), colorMix: CSS.supports('color', 'color-mix(in srgb, red, blue)'), oklch: CSS.supports('color','oklch(0.5 0.1 30)'), svh: CSS.supports('height','100svh'), broadcast: typeof BroadcastChannel !== 'undefined', streams: typeof ReadableStream !== 'undefined', mediaRecorder: typeof MediaRecorder !== 'undefined' }))
        await check('animation actually changes SVG geometry', async () => {
          const leg = page.locator('.track-leg-left')
          await page.locator('.track-scene').scrollIntoViewIfNeeded()
          await page.waitForTimeout(150)
          const values = []
          for(let i=0;i<4;i++) { values.push(await leg.evaluate(el => el.getBBox().height)); await page.waitForTimeout(85) }
          row.legHeights = values
          if(new Set(values).size < 2) throw new Error('SVG leg geometry does not animate')
        })
        await check('pause and resume', async () => {
          await page.getByRole('button', { name: '暂停跑道动画' }).click()
          const before = await page.locator('.track-leg-left').evaluate(el => el.getBBox().height)
          await page.waitForTimeout(150)
          expect(await page.locator('.track-leg-left').evaluate(el => el.getBBox().height)).toBe(before)
          await page.getByRole('button', { name: '播放跑道动画' }).click()
          const time = await page.locator('.track-scene').evaluate(el => el.getCurrentTime())
          await page.waitForTimeout(150)
          expect(await page.locator('.track-scene').evaluate(el => el.getCurrentTime())).toBeGreaterThan(time)
        })
        await check('reduced motion', async () => {
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await expect(page.locator('.track-toggle')).toBeHidden()
          expect(await page.locator('.track-runner').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
          await expect.poll(() => page.locator('.track-scene').evaluate(el => el.animationsPaused())).toBe(true)
          const pose = await page.locator('.track-leg-left').evaluate(el => el.getBBox().height)
          await page.waitForTimeout(150)
          expect(await page.locator('.track-leg-left').evaluate(el => el.getBBox().height)).toBe(pose)
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await expect.poll(() => page.locator('.track-scene').evaluate(el => el.animationsPaused())).toBe(false)
        })
        await check('manual pause survives reduced motion changes', async () => {
          await page.getByRole('button', { name: '暂停跑道动画' }).click()
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await expect(page.getByRole('button', { name: '播放跑道动画' })).toBeVisible()
          expect(await page.locator('.track-scene').evaluate(el => el.animationsPaused())).toBe(true)
          await page.getByRole('button', { name: '播放跑道动画' }).click()
        })
        await check('protected route redirect', async () => {
          await page.goto(base + '/resume'); await expect(page.locator('#email')).toBeVisible()
          expect(new URL(page.url()).pathname).toBe('/login')
        })
        await check('mock login', async () => {
          await page.locator('#email').fill(user.email); await page.locator('#password').fill('compat-password')
          await page.locator('button[type=submit]').click()
          await expect(page.getByText(user.username, { exact: true })).toBeVisible()
        })
        for (const target of ['/jd', '/resume', '/interview']) await check(`authenticated ${target}`, async () => {
          // Client-side link navigation preserves the in-memory identity.
          if(width < 768) await page.locator('header button[aria-label]').first().click()
          await page.locator(`a[href="${target}"]:visible`).first().click()
          await expect(page).toHaveURL(base + target)
          await page.waitForTimeout(400)
          await layout(target.slice(1))
        })
        await check('reload authenticated route', async () => {
          await page.reload(); await page.waitForTimeout(500)
          await expect(page.getByText(user.username, { exact: true })).toBeVisible()
          await layout('reload')
        })
        console.log(JSON.stringify(row))
        await context.close()
      }
    } catch (e) { results.push({ engine: name, launchError: String(e) }); console.log(name, String(e)) }
    finally { await browser?.close() }
  }
} finally {
  await writeFile(path.join(out, process.env.COMPAT_ENGINE ? `results-${process.env.COMPAT_ENGINE}.json` : 'results.json'), JSON.stringify(results, null, 2))
  await new Promise(resolve => server.httpServer.close(resolve))
}
