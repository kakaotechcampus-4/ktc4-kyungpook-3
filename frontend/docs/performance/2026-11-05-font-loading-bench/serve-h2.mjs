import { createSecureServer } from 'node:http2'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'
import { cache, h2Ports } from './paths.mjs'

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}
const tls = { key: readFileSync(join(cache, 'cert/key.pem')), cert: readFileSync(join(cache, 'cert/cert.pem')) }

for (const [v, port] of Object.entries(h2Ports)) {
  const root = join(cache, `dist-${v}`)
  const bodies = new Map()
  const server = createSecureServer({ ...tls, allowHTTP1: false })
  server.on('stream', (stream, headers) => {
    const url = new URL(headers[':path'], 'https://x')
    let file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
    const type = types[extname(file)] ?? 'application/octet-stream'
    const gz = /text|json|svg|manifest/.test(type) && /gzip/.test(headers['accept-encoding'] ?? '')
    const key = file + gz
    if (!bodies.has(key)) bodies.set(key, gz ? gzipSync(readFileSync(file)) : readFileSync(file))
    const out = { ':status': 200, 'content-type': type, 'cache-control': 'no-cache' }
    if (gz) out['content-encoding'] = 'gzip'
    stream.respond(out)
    stream.end(bodies.get(key))
  })
  server.listen(port, () => console.log(`H2 ${v} https://localhost:${port}`))
}
console.log('H2 READY')
