import { build, preview } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const legOnly = process.env.CLOCK_PROBE === 'leg-only'
const out = path.resolve('test-results/animation-clocks' + (legOnly ? '-leg-only' : ''))
await mkdir(out, { recursive: true })
const servers = {}, results = []
let browser
try {
  for (const variant of ['mixed', 'smil']) {
    const dist = path.join(out, variant)
    await build({ build: { outDir: dist, emptyOutDir: true }, plugins: variant === 'mixed' ? [] : [{
      name: 'unified-smil-comparison', enforce: 'pre',
      transform(code, id) {
        id = id.replaceAll('\\', '/')
        if (id.endsWith('/src/components/CareerTrack.css')) return code + '\n.track-runner, .track-grid, .track-shadow { animation: none; }'
        if (!id.endsWith('/src/components/CareerTrack.tsx')) return
        const original = '<path key={i} className="track-grid" style={{ animationDelay: `${i * -0.5}s` }} d="M-1800 420H3000" opacity="0.12" />'
        if (!code.includes(original)) throw new Error('Road markup changed; update comparison fixture')
        code = code.replace(original, `<g key={i} transform="translate(600 100)">
          <g className="track-grid" opacity="0.18">
            <animateTransform attributeName="transform" type="scale" values="1.2;0.02" dur="3s" begin={String(i * -0.5) + "s"} repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.5 0.45 0.9" />
            <animate attributeName="opacity" values="0.18;0.1;0" keyTimes="0;0.75;1" dur="3s" begin={String(i * -0.5) + "s"} repeatCount="indefinite" />
            <path d="M-2400 320H2400" />
          </g>
        </g>`)
        code = code.replace('<ellipse className="track-shadow" cx="600" cy="338" rx="29" ry="7" fill="currentColor" opacity="0.12" />', `<ellipse className="track-shadow" cx="600" cy="338" rx="29" ry="7" fill="currentColor" opacity="0.12">
          <animate attributeName="rx" values="29;23.2;29" dur="0.32s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.12;0.07;0.12" dur="0.32s" repeatCount="indefinite" />
        </ellipse>`)
        code = code.replace('{/* 参考迎面跑姿', `<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 -2;0 0" keyTimes="0;0.45;0.8;1" dur="0.32s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" />
          {/* 参考迎面跑姿`)
        return code
      },
    }] })
    servers[variant] = await preview({ build: { outDir: dist }, preview: { host: '127.0.0.1', port: 0, open: false } })
  }
  browser = await chromium.launch({ channel: 'chrome', headless: false })
  // Warm browser startup outside the A/B sample; each measured context is fresh.
  const warm = await browser.newPage(); await warm.goto('about:blank'); await warm.close()
  for (const count of (legOnly ? [1] : [1, 8])) for (let round=0; round<(legOnly ? 3 : 4); round++) for (const variant of (round % 2 ? ['smil','mixed'] : ['mixed','smil'])) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1100 }, reducedMotion: 'no-preference' })
    await context.addInitScript((legOnly) => {
      window.__probe = { samples: [], errors: [] }
      addEventListener('error', e => window.__probe.errors.push(e.message))
      setInterval(() => {
        const leg = document.querySelector('.track-leg-left'), road = document.querySelector('.track-grid'), runner = document.querySelector('.track-runner'), svg = document.querySelector('.track-scene')
        if (!leg || !road || !runner) return
        window.__probe.samples.push({ t: performance.now(), leg: leg.getBBox().height, road: legOnly ? null : road.getCTM().a, body: legOnly ? null : runner.getCTM().f, clock: svg.getCurrentTime(), visible: document.visibilityState })
      }, 20)
    }, legOnly)
    const pages = []
    for(let i=0;i<count;i++) {
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      pages.push(page)
    }
    await pages.at(-1).bringToFront()
    const url = `http://127.0.0.1:${servers[variant].httpServer.address().port}`
    await Promise.all(pages.map(p => p.goto(url, { waitUntil: 'load' })))
    await new Promise(resolve => setTimeout(resolve, 2000))
    const data = await pages.at(-1).evaluate(() => ({ ...window.__probe, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime }))
    const first = data.samples[0]
    const changes = Object.fromEntries(['leg','road','body'].map(key => {
      const change = data.samples.find(s => Math.abs(s[key]-first[key]) > (key === 'road' ? 0.0001 : 0.1))
      return [key, change ? change.t-first.t : null]
    }))
    const row = { variant, count, round, changes, gap: changes.leg !== null && changes.road !== null ? changes.leg-changes.road : null, data }
    results.push(row)
    console.log(JSON.stringify({ variant, count, round, changes, gap: row.gap, fcp: data.fcp }))
    if (round === 0 && count === 1) {
      await pages[0].screenshot({ path: path.join(out, variant+'.png'), fullPage: true })
      await pages[0].getByRole('button', { name: '暂停跑道动画' }).click()
      const before = await pages[0].evaluate(() => ({ leg: document.querySelector('.track-leg-left').getBBox().height, road: document.querySelector('.track-grid').getCTM().a }))
      await new Promise(resolve => setTimeout(resolve, 150))
      const after = await pages[0].evaluate(() => ({ leg: document.querySelector('.track-leg-left').getBBox().height, road: document.querySelector('.track-grid').getCTM().a }))
      row.pauseStable = JSON.stringify(before) === JSON.stringify(after)
    }
    await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2))
    await context.close()
  }
} finally {
  await browser?.close()
  for (const server of Object.values(servers)) await new Promise(resolve => server.httpServer.close(resolve))
}
