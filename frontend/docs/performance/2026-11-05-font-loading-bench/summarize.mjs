import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cache } from './paths.mjs'

const file = join(cache, process.argv[2] ?? 'results-h1.json')
const results = JSON.parse(readFileSync(file, 'utf8'))
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const fmt = (xs, d = 0) => `${med(xs).toFixed(d)} (${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)})`
const lines = []
for (const page of [...new Set(results.map((r) => r.page))]) {
  lines.push(`\n## ${page}\n`)
  lines.push('| 구성 | n | FCP ms | LCP ms | 폰트 적용 완료 ms | 메인 JS 끝 ms | CLS | 전송량 B | 폰트 B | 요청 | 오류 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  const variants = [...new Set(results.map((r) => r.variant))]
  for (const v of variants) {
    const rs = results.filter((r) => r.page === page && r.variant === v)
    lines.push(
      `| ${v} | ${rs.length} | ${fmt(rs.map((r) => r.fcp))} | ${fmt(rs.map((r) => r.lcp))} | ${fmt(rs.map((r) => r.fontsDone))} | ${fmt(rs.map((r) => r.mainJsEnd))} | ${fmt(rs.map((r) => r.cls), 4)} | ${med(rs.map((r) => r.totalBytes))} | ${med(rs.map((r) => r.fontBytes))} | ${med(rs.map((r) => r.requests))} | ${rs.reduce((s, r) => s + r.errors.length, 0)} |`,
    )
  }
  for (const v of variants) {
    const rs = results.filter((r) => r.page === page && r.variant === v)
    const names = [...new Set(rs.flatMap((r) => r.fonts.map((f) => f.file)))]
    lines.push(`\n${v} 폰트 요청 (시작·끝 중앙값 ms, 우선순위, 바이트), LCP 요소: ${rs[0].lcpEl}`)
    for (const n of names) {
      const fs = rs.map((r) => r.fonts.find((f) => f.file === n)).filter(Boolean)
      lines.push(`- ${n} ${fs.length}/${rs.length}회 · ${med(fs.map((f) => f.start))}→${med(fs.map((f) => f.end))} · ${[...new Set(fs.map((f) => f.priority))].join('/')} · ${med(fs.map((f) => f.bytes))}`)
    }
  }
}
const out = lines.join('\n')
writeFileSync(file.replace(/\.json$/, '.summary.md'), out)
console.log(out)
