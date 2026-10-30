import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const out = path.resolve('test-results/career-track-performance')
await mkdir(out, { recursive: true })
for (const variant of ['with', 'without']) {
  await build({ build: { outDir: path.join(out, variant), emptyOutDir: true }, plugins: variant === 'without' ? [{
    name: 'benchmark-remove-career-track', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/pages/HomePage.tsx'))
        return code.replace(/import \{ CareerTrack \} from [^\n]+\n/, '').replace('<CareerTrack />', '')
    },
  }] : [] })
}
const server = createServer(async (req, res) => {
  try {
    const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean)
    const variant = parts.shift()
    if (!['with', 'without'].includes(variant)) { res.writeHead(404).end(); return }
    const relative = parts.join('/') || 'index.html'
    const file = path.join(out, variant, relative)
    const data = await readFile(file)
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data)
  } catch { res.writeHead(404).end() }
})
// Vite assets use /assets: each run sets the serving variant for absolute URLs.
let active = 'with'
server.prependListener('request', req => { if (!/^\/(with|without)\//.test(req.url)) req.url = '/' + active + req.url })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser
const results = { loads: [], memory: {}, sizes: {} }
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  for (const variant of ['with', 'without']) {
    let bytes = 0, gzip = 0
    for (const name of await readdir(path.join(out, variant, 'assets'))) {
      if (!/\.(js|css)$/.test(name)) continue
      const data = await readFile(path.join(out, variant, 'assets', name)); bytes += data.length; gzip += gzipSync(data).length
    }
    results.sizes[variant] = { bytes, gzip }
  }
  for (let i = 0; i < 12; i++) {
    active = i % 2 ? 'without' : 'with'
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 200000, uploadThroughput: 100000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.addInitScript(() => {
      window.__lcp = 0
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    })
    // Serve index at / so the router renders the actual homepage.
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.locator('h1').waitFor()
    const sample = await page.evaluate(() => ({ fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, lcp: window.__lcp, title: document.querySelector('h1')?.textContent, nodes: document.querySelectorAll('*').length, track: !!document.querySelector('.career-track') }))
    results.loads.push({ variant: active, ...sample, errors })
    console.log('LOAD', JSON.stringify(results.loads.at(-1)))
    if (i < 2) await page.screenshot({ path: path.join(out, `${active}.png`) })
    await context.close()
  }
  for (const variant of ['with', 'without']) {
    active = variant
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } })
    const page = await context.newPage()
    await page.goto(base, { waitUntil: 'networkidle' })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const samples = []
    for (let i = 0; i < 7; i++) {
      if (i) await page.waitForTimeout(10000)
      await cdp.send('HeapProfiler.collectGarbage')
      const { metrics } = await cdp.send('Performance.getMetrics')
      const m = Object.fromEntries(metrics.map(v => [v.name, v.value]))
      samples.push({ seconds: i * 10, heap: m.JSHeapUsedSize, nodes: m.Nodes, task: m.TaskDuration, layout: m.LayoutDuration, style: m.RecalcStyleDuration })
      console.log('MEMORY', variant, JSON.stringify(samples.at(-1)))
    }
    results.memory[variant] = samples
    await context.close()
  }
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
