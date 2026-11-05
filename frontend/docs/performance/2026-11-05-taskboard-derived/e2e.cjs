// usage: node e2e.cjs <baseUrl> <out.json> [rounds]
// MSW 개발 서버의 태스크 화면에 태스크 N건을 넣고, 보드·간트 진입과 보드의 담당자 바꾸기를 Event Timing·직접 시간으로 잰다
const fs = require('fs')
const path = require('path')
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'))

const [base, out, roundsArg = '7'] = process.argv.slice(2)
const ROUNDS = Number(roundsArg)
const SIZES = (process.env.SIZES ?? '500,2000').split(',').map(Number)
const TASKS = '/workspaces/ws_01/tasks'

async function seed(page, size) {
  await page.goto(`${base}${TASKS}?msw-scenario=tasks-default`)
  await page.waitForURL((url) => !url.search.includes('msw-scenario'))
  await page.waitForSelector('h1:has-text("태스크")', { timeout: 30_000 })
  await page.evaluate((size) => {
    const stored = JSON.parse(sessionStorage.getItem('msw-db'))
    const db = stored.db
    const members = db.members.filter((m) => m.workspace_id === 'ws_01').map((m) => m.member_id)
    let seed = size
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296)
    const day = (offset) => new Date(Date.UTC(2026, 8, 18 + offset)).toISOString().slice(0, 10)
    const statuses = ['todo', 'in_progress', 'blocked', 'done']
    const baseTask = db.tasks.find((t) => t.workspace_id === 'ws_01')
    const tasks = Array.from({ length: size }, (_, index) => {
      const created = new Date(Date.UTC(2026, 6, 1) + Math.floor(random() * 80 * 86400000))
      return {
        ...baseTask,
        task_id: `tk_p${index}`,
        title: `태스크 ${index}`,
        status: statuses[Math.floor(random() * 4)],
        assignee_member_id: random() < 0.1 ? null : members[index % members.length],
        due_date: random() < 0.2 ? null : day(Math.floor(random() * 40) - 15),
        notion_sync_status: random() < 0.5 ? 'synced' : null,
        created_at: created.toISOString(),
        updated_at: new Date(created.getTime() + Math.floor(random() * 5) * 3600000).toISOString(),
      }
    })
    db.tasks = [...db.tasks.filter((t) => t.workspace_id !== 'ws_01'), ...tasks]
    const baseApproval = db.approvals.find((a) => a.workspace_id === 'ws_01' && a.type === 'task_create')
    db.approvals = [
      ...db.approvals.filter((a) => a.workspace_id !== 'ws_01'),
      ...Array.from({ length: size / 10 }, (_, index) => ({
        ...baseApproval,
        approval_id: `ap_p${index}`,
        status: 'pending',
        created_at: tasks[index].created_at,
      })),
    ]
    const baseMeeting = db.meetings.find((m) => m.workspace_id === 'ws_01')
    db.meetings = [
      ...db.meetings,
      ...Array.from({ length: size / 5 }, (_, index) => ({
        ...baseMeeting,
        meeting_id: `mt_p${index}`,
        title: `회의 ${index}`,
        started_at: tasks[index].created_at,
      })),
    ]
    sessionStorage.setItem('msw-db', JSON.stringify(stored))
  }, size)
}

const OBSERVE = () => {
  window.__events = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.interactionId) window.__events.push({ name: entry.name, duration: entry.duration })
  }).observe({ type: 'event', durationThreshold: 16, buffered: true })
}

/** 화면이 다 그려질 때까지 — 다음 두 프레임 */
const settle = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function enterView(page, view, readySelector) {
  const start = Date.now()
  await page.goto(`${base}${TASKS}?view=${view}&month=2026-09&from=2026-09-14`)
  await page.waitForSelector(readySelector, { timeout: 60_000 })
  await settle(page)
  return Date.now() - start
}

async function assigneeRound(page, memberName) {
  const results = []
  for (const target of [memberName, '담당자 전체']) {
    await page.evaluate(() => (window.__events = []))
    await page.getByRole('button', { name: /^담당자:/ }).click()
    const option = page.getByRole('menuitemradio', { name: target })
    await option.waitFor()
    const start = await page.evaluate(() => performance.now())
    await option.click()
    await page.getByRole('button', { name: `담당자: ${target}` }).waitFor()
    await settle(page)
    const end = await page.evaluate(() => performance.now())
    const events = await page.evaluate(() => window.__events)
    results.push({
      target,
      wallMs: end - start,
      maxEventMs: events.reduce((max, e) => Math.max(max, e.duration), 0),
    })
  }
  return results
}

;(async () => {
  const browser = await chromium.launch()
  const report = { base, rounds: ROUNDS, chromium: browser.version(), sizes: {} }
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => console.error('pageerror', error.message))
    await page.addInitScript(OBSERVE)
    await seed(page, size)
    const entry = { board: [], gantt: [], assignee: [] }
    await enterView(page, 'board', '[aria-label="시작 전"]')
    const seeded = await page.evaluate(() => JSON.parse(sessionStorage.getItem('msw-db')).db.tasks.length)
    if (seeded < size) throw new Error(`seeded ${seeded} tasks, expected ${size}`)
    const memberName = await page.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('msw-db')).db
      return db.members.find((m) => m.workspace_id === 'ws_01').display_name
    })
    for (let round = 0; round < ROUNDS; round += 1) {
      entry.board.push(await enterView(page, 'board', '[aria-label="시작 전"]'))
      entry.assignee.push(...(await assigneeRound(page, memberName)))
      entry.gantt.push(await enterView(page, 'gantt', '[aria-label="일정 표"]'))
    }
    const count = await page.evaluate(() => JSON.parse(sessionStorage.getItem('msw-db')).db.tasks.length)
    report.sizes[size] = { dbTasks: count, ...entry }
    console.log(size, 'board', entry.board, 'gantt', entry.gantt)
    console.log(size, 'assignee', entry.assignee.map((r) => `${r.wallMs.toFixed(0)}/${r.maxEventMs}`).join(' '))
    await context.close()
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  await browser.close()
})()
