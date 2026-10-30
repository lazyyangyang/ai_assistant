import { defineConfig, devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import net from 'node:net'

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
const front = Number(process.env.E2E_FRONT_PORT ??= String(await freePort()))
const back = Number(process.env.E2E_BACK_PORT ??= String(await freePort()))
const run = process.env.E2E_RUN_ID ??= randomUUID()
const testDir = path.resolve('test-results', run)
export default defineConfig({
  testDir: './e2e', outputDir: `${testDir}/artifacts`, timeout: 30_000,
  workers: 1, fullyParallel: false, retries: 0,
  reporter: [['list'], ['html', { outputFolder: `${testDir}/report`, open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${front}`, screenshot: 'only-on-failure', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHROMIUM_CHANNEL } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: `..\\backend\\.venv\\Scripts\\python.exe -m uvicorn tests.e2e_app:app --app-dir ../backend --host 127.0.0.1 --port ${back}`,
      url: `http://127.0.0.1:${back}/api/e2e/isolation`, reuseExistingServer: false,
      env: { AI_CAREER_E2E_DIR: testDir, AI_CAREER_E2E_FRONT_PORT: String(front) } },
    { command: `pnpm exec vite --host 127.0.0.1 --port ${front} --strictPort`,
      url: `http://127.0.0.1:${front}`, reuseExistingServer: false,
      env: { AI_CAREER_API_PROXY: `http://127.0.0.1:${back}` } },
  ],
})
