import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ?raw 는 쓰지 않는다 — vitest 의 test.css: false 가 CSS import 를 빈 문자열로 만든다. */
const css = readFileSync(resolve(import.meta.dirname, 'global.css'), 'utf8')

/* jsdom 은 이 CSS 를 계산하지 않는다 — 규칙 문장을 계약으로 고정하고,
   실제로 그려지는지는 브라우저에서 본다 (docs/plan/focus-visible-outline.md Task 5). */
describe('global focus rule', () => {
  it('draws a 2px ink outline over the existing border on focus-visible', () => {
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(rule).toMatch(/outline:\s*2px solid var\(--color-ink\);/)
    expect(rule).toMatch(/outline-offset:\s*-1px;/)
  })

  it('no longer strips the outline', () => {
    expect(css).not.toMatch(/outline:\s*none/)
  })

  it('leaves plain :focus alone so a mouse click draws nothing', () => {
    expect(css).not.toMatch(/(^|[\s,]):focus\s*[,{]/m)
  })
})
