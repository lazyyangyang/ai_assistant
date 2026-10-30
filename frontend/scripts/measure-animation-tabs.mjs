import { build, preview } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('test-results/animation-tabs')
await mkdir(out, { recursive: true })
await build({ build: { outDir: path.join(out, 'dist'), emptyOutDir: true } })
const server = await preview({ build: { outDir: path.join(out, 'dist') }, preview: { host: '127.0.0.1', port: 0, open: false } })
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const result = []
let browser
try {
  // Restore Chrome's normal background policy; use real tabs in a headed window.
  browser = await chromium.launch({ channel: 'chrome', headless: false, ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
  for (const rate of [1, 4]) for (let round=0; round<3; round++) for (const count of [1, 4, 8]) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1100 }, reducedMotion: 'no-preference' })
    await context.addInitScript(() => {
      const data = window.__animationProbe = { mounted: null, samples: [], frames: [], longTasks: [], visibility: [{ t: performance.now(), value: document.visibilityState }], errors: [] }
      addEventListener('error', e => data.errors.push(e.message))
      document.addEventListener('visibilitychange', () => data.visibility.push({ t: performance.now(), value: document.visibilityState }))
      new PerformanceObserver(list => { for (const e of list.getEntries()) data.longTasks.push({ t: e.startTime, duration: e.duration }) }).observe({ type: 'longtask', buffered: true })
      let previous
      function frame(t) {
        if (previous !== undefined) data.frames.push({ t, gap: t-previous, visible: document.visibilityState === 'visible' })
        previous = t
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      setInterval(() => {
        const leg = document.querySelector('.track-leg-left'), svg = document.querySelector('.track-scene')
        if (!leg || !svg) return
        const t = performance.now()
        data.mounted ??= t
        data.samples.push({ t, height: leg.getBBox().height, length: leg.getTotalLength(), clock: svg.getCurrentTime(), paused: svg.animationsPaused(), visible: document.visibilityState === 'visible' })
      }, 50)
    })
    const pages = []
    for (let i=0; i<count; i++) {
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate })
      pages.push(page)
    }
    await pages.at(-1).bringToFront()
    await Promise.all(pages.map(page => page.goto(base, { waitUntil: 'load' })))
    await new Promise(resolve => setTimeout(resolve, 4500))
    const snapshots = await Promise.all(pages.map(page => page.evaluate(() => ({ ...window.__animationProbe, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, now: performance.now() }))))
    let switched
    if (count > 1) {
      await pages[0].bringToFront()
      await new Promise(resolve => setTimeout(resolve, 1200))
      switched = await pages[0].evaluate(() => window.__animationProbe)
    }
    const summary = snapshots.map(d => {
      const visible = d.samples.filter(s => s.visible)
      const first = visible[0], movement = visible.find(s => Math.abs(s.height-first.height)>0.1)
      const gaps = d.frames.filter(f => f.visible && f.t >= d.mounted && f.t-d.mounted < 4000).map(f=>f.gap)
      return { fcp: d.fcp, mounted: d.mounted, visibility: d.visibility, movementDelay: movement ? movement.t-first.t : null, maxFrameGap: gaps.length ? Math.max(...gaps) : null, over50ms: gaps.filter(g=>g>50).length, poses: new Set(visible.map(s=>s.height.toFixed(2))).size, longTasks: d.longTasks, errors: d.errors }
    })
    const row = { rate, round, count, summary, snapshots, switched }
    result.push(row)
    console.log(JSON.stringify({ rate, round, count, foreground: summary.at(-1) }))
    await writeFile(path.join(out, 'results.json'), JSON.stringify(result))
    await context.close()
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
