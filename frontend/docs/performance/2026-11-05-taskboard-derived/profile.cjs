// usage: SIZES=2000 node profile.cjs <baseUrl> <out.json> [rounds]
// 보드에서 담당자 바꾸기·간트 진입 동안 CPU 프로파일을 떠서, TaskBoard 파생 함수가 차지하는 inclusive 시간과 전체 바쁜 시간을 비교한다
const fs = require('fs')
const path = require('path')
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'))

const [base, out, roundsArg = '5'] = process.argv.slice(2)
const ROUNDS = Number(roundsArg)
const SIZES = (process.env.SIZES ?? '500,2000').split(',').map(Number)
const TASKS = '/workspaces/ws_01/tasks'
const TARGETS = ['buildTaskBoard', 'seoulDateOf', 'createApprovals', 'filterTasksByAssignee', 'withPendingStatus']

const e2eSource = fs.readFileSync(path.join(__dirname, 'e2e.cjs'), 'utf8')
const seedBody = e2eSource.slice(e2eSource.indexOf('async function seed'), e2eSource.indexOf('const OBSERVE'))
const seed = new Function('base', 'TASKS', `${seedBody}; return seed`)(base, TASKS)

/** 프로파일 트리에서 이름이 맞는 프레임의 inclusive 시간(ms). 재귀로 겹치면 바깥 것만 센다 */
function summarize(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  const deltas = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i += 1)
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (deltas[i] ?? 0) / 1000)
  const result = Object.fromEntries(TARGETS.map((name) => [name, 0]))
  let busy = 0
  const walk = (id, inside) => {
    const node = byId.get(id)
    const name = node.callFrame.functionName
    const time = self.get(id) ?? 0
    if (!['(idle)', '(program)', '(garbage collector)'].includes(name)) busy += time
    else if (name === '(garbage collector)') busy += time
    const hit = TARGETS.includes(name) && !inside.has(name) ? name : null
    for (const target of inside) result[target] += time
    const next = hit ? new Set([...inside, hit]) : inside
    if (hit) result[hit] += time
    for (const child of node.children ?? []) walk(child, next)
  }
  walk(profile.nodes[0].id, new Set())
  return { busyMs: busy, ...result }
}

;(async () => {
  const browser = await chromium.launch()
  const report = { base, rounds: ROUNDS, chromium: browser.version(), sizes: {} }
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await seed(page, size)
    await page.goto(`${base}${TASKS}?view=board`)
    await page.waitForSelector('[aria-label="시작 전"]', { timeout: 120_000 })
    const seeded = await page.evaluate(() => JSON.parse(sessionStorage.getItem('msw-db')).db.tasks.length)
    if (seeded < size) throw new Error(`seeded ${seeded}`)
    const memberName = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('msw-db')).db.members.find((m) => m.workspace_id === 'ws_01').display_name,
    )
    const cdp = await context.newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    const samples = []
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const target of [memberName, '담당자 전체']) {
        await page.getByRole('button', { name: /^담당자:/ }).click()
        const option = page.getByRole('menuitemradio', { name: target })
        await option.waitFor()
        await cdp.send('Profiler.start')
        await option.click()
        await page.getByRole('button', { name: `담당자: ${target}` }).waitFor()
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const { profile } = await cdp.send('Profiler.stop')
        samples.push({ action: `assignee→${target}`, ...summarize(profile) })
      }
    }
    report.sizes[size] = samples
    for (const s of samples)
      console.log(size, s.action.padEnd(16), Object.entries(s).slice(1).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' '))
    await context.close()
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  await browser.close()
})()
