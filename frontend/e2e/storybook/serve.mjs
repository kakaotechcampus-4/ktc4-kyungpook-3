import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

/*
 * storybook-static/ 을 그대로 내보내는 정적 서버 (playwright.storybook.config.ts 의 webServer).
 * 프록시도 SPA fallback 도 없다 — MSW 가 받지 않은 `/api/v1/*` 요청은 404 로 드러난다.
 * `vite preview` 는 `server.proxy` 를 물려받아 그런 요청을 로컬 백엔드(:8000)로 보내 버린다.
 */
const ROOT = resolve(import.meta.dirname, '../../storybook-static')
const PORT = Number(process.argv[2] ?? 6211)

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** @param {string} url @returns {string | null} */
function fileFor(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const path = normalize(join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname))
  if (!path.startsWith(ROOT)) return null
  try {
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

createServer((req, res) => {
  const path = fileFor(req.url ?? '/')
  if (!path) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(res)
}).listen(PORT, () => {
  console.log(`storybook-static on http://localhost:${PORT}`)
})
