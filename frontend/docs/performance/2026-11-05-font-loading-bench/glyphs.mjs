import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cache, h1Ports } from './paths.mjs'

const recording = JSON.parse(readFileSync(join(cache, 'api-recording.json'), 'utf8'))
const me = recording.login.find((c) => c.path === '/api/v1/auth/me')
const sample = '가나다 똠방각하 뷁쌰 ABC xyz 0123456789 ₩1,000 … “인용” → ≤ ① ㎡ ™'
const variants = { A: h1Ports.A, B: h1Ports.B }
const browser = await chromium.launch()
const shots = {}
for (const [v, port] of Object.entries(variants)) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' })
  await context.route(/\/api\/v1\//, (r) => r.fulfill({ status: me.status, contentType: me.contentType, body: me.body }))
  const page = await context.newPage()
  await page.goto(`http://localhost:${port}/login`)
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  await page.evaluate((text) => {
    const box = document.createElement('div')
    box.id = 'glyphs'
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#fff;padding:8px;font-family:NanumSquare;font-size:20px'
    for (const w of [300, 400, 700, 800]) {
      const p = document.createElement('p')
      p.style.fontWeight = String(w)
      p.textContent = `${w} ${text}`
      box.append(p)
    }
    document.body.append(box)
  }, sample)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  const faces = await page.evaluate(() => [...document.fonts].map((f) => `${f.weight} ${f.status}`))
  const glyphs = await page.locator('#glyphs').screenshot({ path: join(cache, 'shots', `glyphs-${v}.png`) })
  await page.evaluate(() => document.getElementById('glyphs').remove())
  const full = await page.screenshot({ path: join(cache, 'shots', `login-filled-${v}.png`) })
  const pw = await page.getByLabel('비밀번호', { exact: true }).screenshot({ path: join(cache, 'shots', `password-${v}.png`) })
  shots[v] = { glyphs, full, pw, faces }
  await context.close()
}
await browser.close()
const same = (k) => Buffer.compare(shots.A[k], shots.B[k]) === 0
const report = { glyphsIdentical: same('glyphs'), loginIdentical: same('full'), passwordIdentical: same('pw'), facesA: shots.A.faces, facesB: shots.B.faces }
writeFileSync(join(cache, 'glyphs.json'), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report))
