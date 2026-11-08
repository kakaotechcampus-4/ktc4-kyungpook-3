import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cache, h1Ports, h2Ports, variants as allVariants } from './paths.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)
const runs = Number(args.runs ?? 7)
const variants = args.variants ? args.variants.split(',') : allVariants
const pages = (args.pages ?? 'login,dashboard').split(',')
const h2 = args.proto === 'h2'
const ports = h2 ? h2Ports : h1Ports
const outFile = join(cache, args.out ?? `results-${h2 ? 'h2' : 'h1'}.json`)
const shots = join(cache, 'shots')
mkdirSync(shots, { recursive: true })

// Chrome DevTools "Slow 4G" preset: 1.6 Mbps * 0.9 down, 750 kbps * 0.9 up, 150 ms * 3.75 latency
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1000 * 1000) / 8 * 0.9, uploadThroughput: (750 * 1000) / 8 * 0.9 }

const recording = JSON.parse(readFileSync(join(cache, 'api-recording.json'), 'utf8'))
const targets = {
  login: { path: '/login', ready: 'button[type="submit"]', expectStatus: { '/api/v1/auth/me': 401, '/api/v1/workspaces': 401 } },
  dashboard: { path: '/workspaces/ws_01/dashboard', ready: '[aria-label="최근 반영 목록"]', expectStatus: {} },
}

const initScript = (readySelector) => {
  const m = { lcp: [], shifts: [], paint: {}, fontEvents: [], ready: null }
  window.__m = m
  new PerformanceObserver((l) => {
    for (const e of l.getEntries())
      m.lcp.push({ t: e.startTime, size: e.size, tag: e.element?.tagName ?? null, text: (e.element?.textContent ?? '').slice(0, 40) })
  }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) m.shifts.push({ t: e.startTime, v: e.value })
  }).observe({ type: 'layout-shift', buffered: true })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) m.paint[e.name] = e.startTime
  }).observe({ type: 'paint', buffered: true })
  document.fonts.addEventListener('loadingdone', (e) => {
    m.fontEvents.push({ t: performance.now(), faces: e.fontfaces.map((f) => `${f.weight}|${f.unicodeRange.slice(0, 12)}|${f.status}`) })
  })
  const poll = () => {
    if (m.ready === null && document.querySelector(readySelector)) m.ready = performance.now()
    if (m.ready === null) requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
}

async function measureOnce(browser, variant, pageName, shot) {
  const target = targets[pageName]
  const origin = `${h2 ? 'https' : 'http'}://localhost:${ports[variant]}`
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block', ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const calls = recording[pageName]
  const apiErrors = []
  await context.route(/\/api\/v1\//, async (route) => {
    const u = new URL(route.request().url())
    const key = u.pathname + u.search
    const hit = calls.find((c) => c.method === route.request().method() && c.path === key)
    if (!hit && pageName === 'login') {
      const me = calls.find((c) => c.path === '/api/v1/auth/me')
      return route.fulfill({ status: me.status, contentType: me.contentType, body: me.body })
    }
    if (!hit) {
      apiErrors.push(`${route.request().method()} ${key} unrecorded`)
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ status: hit.status, contentType: hit.contentType, body: hit.body })
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', SLOW_4G)
  const reqs = new Map()
  let pending = 0
  let lastActivity = Date.now()
  cdp.on('Network.requestWillBeSent', (e) => {
    if (reqs.has(e.requestId)) return
    reqs.set(e.requestId, { url: e.request.url, priority: e.request.initialPriority ?? e.initialPriority, type: e.type, start: e.timestamp })
    pending++
    lastActivity = Date.now()
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId)
    if (r) {
      r.status = e.response.status
      r.protocol = e.response.protocol
      r.type = e.type
    }
  })
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId)
    if (r && r.end === undefined) {
      r.end = e.timestamp
      r.bytes = e.encodedDataLength
      pending--
    }
    lastActivity = Date.now()
  })
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId)
    if (r && r.end === undefined) {
      r.end = e.timestamp
      r.failed = e.errorText
      pending--
    }
    lastActivity = Date.now()
  })
  await page.addInitScript(initScript, target.ready)
  await page.goto(origin + target.path, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForSelector(target.ready, { timeout: 60_000 })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const fontsLoaded = await page.evaluate(() => document.fonts.status === 'loaded')
    if (pending <= 0 && fontsLoaded && Date.now() - lastActivity > 2000) break
    await page.waitForTimeout(200)
  }
  const m = await page.evaluate(() => window.__m)
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }
  })
  const fontFaces = await page.evaluate(() => [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => `${f.weight}|${f.unicodeRange.slice(0, 20)}|${f.status}`))
  if (shot) await page.screenshot({ path: join(shots, `${h2 ? 'h2-' : ''}${variant}-${pageName}.png`) })
  await context.close()

  const list = [...reqs.values()].filter((r) => !r.url.startsWith('data:'))
  const t0 = Math.min(...list.map((r) => r.start))
  const rel = (t) => (t === undefined ? null : Math.round((t - t0) * 1000))
  const net = list.map((r) => ({
    file: new URL(r.url).pathname.replace('/assets/', ''),
    priority: r.priority,
    type: r.type,
    status: r.status ?? null,
    protocol: r.protocol ?? null,
    failed: r.failed ?? null,
    start: rel(r.start),
    end: rel(r.end),
    bytes: r.bytes ?? 0,
  }))
  const httpErrors = net.filter((r) => {
    if (r.failed) return true
    if (r.status === null || r.status < 400) return false
    const p = r.file.split('?')[0]
    return target.expectStatus[p] !== r.status
  })
  const fonts = net.filter((r) => r.file.endsWith('.woff2'))
  const mainJs = net.find((r) => /^index-.*\.js$/.test(r.file))
  const lcp = m.lcp.at(-1) ?? null
  return {
    variant,
    page: pageName,
    fcp: m.paint['first-contentful-paint'] ?? null,
    lcp: lcp?.t ?? null,
    lcpEl: lcp ? `${lcp.tag}:${lcp.text}` : null,
    cls: m.shifts.reduce((s, e) => s + e.v, 0),
    shifts: m.shifts,
    ready: m.ready,
    dcl: nav.dcl,
    load: nav.load,
    fontsDone: m.fontEvents.length ? m.fontEvents.at(-1).t : null,
    fontEvents: m.fontEvents,
    fontFaces,
    mainJsEnd: mainJs?.end ?? null,
    totalBytes: net.reduce((s, r) => s + r.bytes, 0),
    fontBytes: fonts.reduce((s, r) => s + r.bytes, 0),
    requests: net.length,
    protocols: [...new Set(net.map((r) => r.protocol))],
    errors: [...apiErrors, ...httpErrors.map((r) => `${r.file} ${r.status ?? r.failed}`)],
    fonts,
    net,
  }
}

const browser = await chromium.launch()
const results = []
for (let i = 0; i < runs; i++) {
  for (const pageName of pages) {
    const order = variants.map((_, k) => variants[(k + i) % variants.length])
    for (const v of order) {
      const r = await measureOnce(browser, v, pageName, i === 0)
      r.run = i
      results.push(r)
      writeFileSync(outFile, JSON.stringify(results, null, 1))
      console.log(
        `run ${i} ${pageName} ${v} fcp=${Math.round(r.fcp)} lcp=${Math.round(r.lcp)} ready=${Math.round(r.ready)} fonts=${Math.round(r.fontsDone)} js=${r.mainJsEnd} cls=${r.cls.toFixed(4)} bytes=${r.totalBytes} errors=${r.errors.length}`,
      )
    }
  }
}
await browser.close()
console.log('MEASURE DONE', outFile)
