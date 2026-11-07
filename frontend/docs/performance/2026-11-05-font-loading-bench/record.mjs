import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cache } from './paths.mjs'

const origin = process.argv[2] ?? 'http://localhost:43529'
const flows = [
  { name: 'login', scenario: 'signed-out', path: '/login', ready: (p) => p.getByRole('button', { name: '로그인', exact: true }) },
  {
    name: 'dashboard',
    scenario: 'dashboard-default',
    path: '/workspaces/ws_01/dashboard',
    ready: (p) => p.getByRole('list', { name: '최근 반영 목록' }),
  },
]

const browser = await chromium.launch()
const recording = {}
for (const flow of flows) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-09-18T09:00:00+09:00'))
  const calls = []
  page.on('response', async (res) => {
    const url = new URL(res.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    const body = await res.body().catch(() => Buffer.alloc(0))
    calls.push({
      method: res.request().method(),
      path: url.pathname + url.search,
      status: res.status(),
      contentType: res.headers()['content-type'] ?? 'application/json',
      body: body.toString('utf8'),
    })
  })
  await page.goto(`${origin}${flow.path}?msw-scenario=${flow.scenario}`)
  await flow.ready(page).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2000)
  recording[flow.name] = calls
  console.log(flow.name, calls.map((c) => `${c.method} ${c.path} ${c.status}`).join('\n  '))
  await context.close()
}
await browser.close()
writeFileSync(join(cache, 'api-recording.json'), JSON.stringify(recording, null, 2))
console.log('RECORDED')
