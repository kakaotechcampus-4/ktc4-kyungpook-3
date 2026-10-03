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

/* 브라우저에서 확인: NanumSquare 의 U+2022 글리프는 잉크가 0 이다 (docs/impl-decision/2026-09-29-nanum-bullet-glyph.md) */
describe('NanumSquare @font-face', () => {
  const fonts = readFileSync(resolve(import.meta.dirname, 'fonts.css'), 'utf8')
  const faces = fonts.match(/@font-face\s*\{[^}]*\}/g) ?? []

  it('네 벌 모두 U+2022(비밀번호 가림 문자)를 폴백 폰트에 넘긴다', () => {
    expect(faces).toHaveLength(4)
    for (const face of faces) {
      expect(face).toMatch(/unicode-range:\s*U\+0-2021,\s*U\+2023-10FFFF;/)
    }
  })
})
