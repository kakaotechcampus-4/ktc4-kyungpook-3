// usage: node profile-board.cjs <baseUrl> <size> <out.json>  보드 진입의 self time 상위 함수
const fs = require('fs'), path = require('path')
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'))
const [base, sizeArg, out] = process.argv.slice(2)
const TASKS = '/workspaces/ws_01/tasks'
const src = fs.readFileSync(path.join(__dirname, 'e2e.cjs'), 'utf8')
const seed = new Function('base', 'TASKS', `${src.slice(src.indexOf('async function seed'), src.indexOf('const OBSERVE'))}; return seed`)(base, TASKS)
;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await seed(page, Number(sizeArg))
  await page.goto(`${base}${TASKS}?view=gantt&from=2026-09-14`)
  await page.waitForSelector('[aria-label="일정 표"]', { timeout: 60000 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await cdp.send('Profiler.start')
  const t = Date.now()
  await page.getByRole('radio', { name: '보드' }).or(page.getByRole('tab', { name: '보드' })).or(page.getByRole('button', { name: '보드' })).first().click()
  await page.waitForSelector('[aria-label="시작 전"]', { timeout: 120000 })
  const wall = Date.now() - t
  const { profile } = await cdp.send('Profiler.stop')
  const self = new Map()
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000))
  const agg = new Map()
  for (const n of profile.nodes) {
    const f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`
    agg.set(key, (agg.get(key) ?? 0) + (self.get(n.id) ?? 0))
  }
  const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log('switch to board wall ms', wall)
  for (const [k, v] of top) console.log(v.toFixed(0).padStart(7), k)
  fs.writeFileSync(out, JSON.stringify({ wall, top }, null, 2))
  await browser.close()
})()
