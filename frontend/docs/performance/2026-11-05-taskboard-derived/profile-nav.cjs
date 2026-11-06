// usage: SIZES=2000 node profile-nav.cjs <baseUrl> <out.json> [rounds]
// 캘린더 달 이동·간트 주 이동·보기 전환 동안 CPU 프로파일을 떠서 TaskBoard 파생 함수의 inclusive 시간과 전체 바쁜 시간을 비교한다
const fs = require('fs')
const path = require('path')
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'))

const [base, out, roundsArg = '3'] = process.argv.slice(2)
const ROUNDS = Number(roundsArg)
const SIZES = (process.env.SIZES ?? '2000').split(',').map(Number)
const TASKS = '/workspaces/ws_01/tasks'
const TARGETS = ['buildTaskBoard', 'seoulDateOf', 'createApprovals', 'filterTasksByAssignee', 'withPendingStatus']

const e2eSource = fs.readFileSync(path.join(__dirname, 'e2e.cjs'), 'utf8')
const seedBody = e2eSource.slice(e2eSource.indexOf('async function seed'), e2eSource.indexOf('const OBSERVE'))
const seed = new Function('base', 'TASKS', `${seedBody}; return seed`)(base, TASKS)

function summarize(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i += 1)
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
  const result = Object.fromEntries(TARGETS.map((name) => [name, 0]))
  let busy = 0
  const walk = (id, inside) => {
    const node = byId.get(id)
    const name = node.callFrame.functionName
    const time = self.get(id) ?? 0
    if (!['(idle)', '(program)'].includes(name)) busy += time
    for (const target of inside) result[target] += time
    const hit = TARGETS.includes(name) && !inside.has(name) ? name : null
    if (hit) result[hit] += time
    const next = hit ? new Set([...inside, hit]) : inside
    for (const child of node.children ?? []) walk(child, next)
  }
  walk(profile.nodes[0].id, new Set())
  return { busyMs: busy, ...result }
}

const ACTIONS = [
  { name: 'calendar 다음 달', role: 'button', label: '다음 달', ready: '[aria-label="2026년 10월"]' },
  { name: 'calendar 이전 달', role: 'button', label: '이전 달', ready: '[aria-label="2026년 9월"]' },
  { name: 'calendar → gantt', role: 'radio', label: '간트', ready: '[aria-label="일정 표"]' },
  { name: 'gantt 다음 3주', role: 'button', label: '다음 3주' },
  { name: 'gantt 이전 3주', role: 'button', label: '이전 3주' },
  { name: 'gantt → calendar', role: 'radio', label: '캘린더', ready: '[aria-label="2026년 9월"]' },
]

;(async () => {
  const browser = await chromium.launch()
  const report = { base, rounds: ROUNDS, chromium: browser.version(), sizes: {} }
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await seed(page, size)
    // 두 보기의 코드를 먼저 받아 둔다. 잴 때는 lazy 로딩이 끼지 않는다
    await page.goto(`${base}${TASKS}?view=gantt&from=2026-09-14`)
    await page.waitForSelector('[aria-label="일정 표"]', { timeout: 120_000 })
    await page.goto(`${base}${TASKS}?view=calendar&month=2026-09&from=2026-09-14`)
    await page.waitForSelector('[aria-label="2026년 9월"]', { timeout: 120_000 })
    const seeded = await page.evaluate(() => JSON.parse(sessionStorage.getItem('msw-db')).db.tasks.length)
    if (seeded < size) throw new Error(`seeded ${seeded}`)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    const samples = []
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const action of ACTIONS) {
        const control = page.getByRole(action.role, { name: action.label, exact: true })
        await control.waitFor()
        const before = await page.evaluate(() => location.search)
        await cdp.send('Profiler.start')
        await control.click()
        if (action.ready) await page.waitForSelector(action.ready)
        else await page.waitForFunction((previous) => location.search !== previous, before)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const { profile } = await cdp.send('Profiler.stop')
        samples.push({ action: action.name, search: await page.evaluate(() => location.search), ...summarize(profile) })
      }
    }
    report.sizes[size] = samples
    for (const s of samples)
      console.log(size, s.action.padEnd(18), Object.entries(s).slice(2).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' '))
    await context.close()
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  await browser.close()
})()
