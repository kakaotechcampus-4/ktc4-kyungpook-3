const { createRequire } = require('node:module')
const path = require('node:path')
const { writeFileSync } = require('node:fs')
const frontend = path.resolve(__dirname, '../../../../frontend')
const { chromium, expect } = createRequire(path.join(frontend, 'package.json'))('@playwright/test')

async function inspect(baseURL, evidence) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const result = { baseURL, browser: browser.version(), checkedAt: new Date().toISOString(), status: 'failed' }
  try {
    const client = await context.request.get(`${baseURL}/@vite/client`)
    expect(client.ok(), 'Owned Vite dev instance must serve its client').toBe(true)
    const page = await context.newPage()
    await page.goto(`${baseURL}/login`)
    await expect(page.getByLabel('이메일')).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
    const auth = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/me')
      return { status: response.status, body: await response.json(), worker: navigator.serviceWorker.controller?.scriptURL }
    })
    expect(auth.status, 'Fresh context must be signed out').toBe(401)
    expect(auth.worker, 'MSW must control API traffic').toContain('/mockServiceWorker.js')
    result.auth = auth
    result.status = 'passed'
    await page.screenshot({ path: path.join(evidence, 'doctor.png'), fullPage: true })
    writeFileSync(path.join(evidence, 'doctor.aria.txt'), await page.locator('body').ariaSnapshot())
  } catch (error) {
    result.error = String(error)
    throw error
  } finally {
    writeFileSync(path.join(evidence, 'doctor.json'), JSON.stringify(result, null, 2))
    await context.close()
    await browser.close()
  }
}

module.exports = async config => inspect(config.projects[0].use.baseURL, process.env.VERIFY_EVIDENCE)
module.exports.inspect = inspect
