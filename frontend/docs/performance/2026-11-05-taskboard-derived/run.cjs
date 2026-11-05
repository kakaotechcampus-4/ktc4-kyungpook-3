// usage: node run.cjs <bundle.js> <out.json> [node|chromium] [rounds]
const fs = require('fs'), path = require('path'), vm = require('vm')
const [bundle, out, where = 'node', rounds = '15'] = process.argv.slice(2)
const code = fs.readFileSync(bundle, 'utf8')
;(async () => {
  let report
  if (where === 'node') {
    globalThis.window = { location: { origin: 'http://localhost' } }
    vm.runInThisContext(code)
    report = { runtime: `node ${process.version}`, ...globalThis.Bench.run(Number(rounds)) }
  } else {
    const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'))
    const browser = await chromium.launch()
    const page = await browser.newPage()
    page.on('pageerror', (error) => console.error('pageerror', error.message))
    await page.route('http://bench.local/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bench</title>' }))
    await page.goto('http://bench.local/')
    await page.addScriptTag({ content: code })
    const ua = await page.evaluate(() => navigator.userAgent)
    report = { runtime: `chromium ${browser.version()} (${ua})`, ...(await page.evaluate((r) => Bench.run(r), Number(rounds))) }
    await browser.close()
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log('wrote', out, report.runtime)
})()
