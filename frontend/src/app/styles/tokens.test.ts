import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { compile } from 'tailwindcss'

const require = createRequire(import.meta.url)

/* 빌드가 쓰는 index.css 를 Tailwind 로 직접 컴파일한다. 클래스가 CSS 에 없어도 빌드·타입·jsdom 은 모두 통과하기 때문이다 (#497). */
async function buildUtilities(candidates: string[]): Promise<string> {
  const entry = resolve(import.meta.dirname, 'index.css')
  const compiler = await compile(await readFile(entry, 'utf8'), {
    base: dirname(entry),
    async loadStylesheet(id, base) {
      const path = id.startsWith('.')
        ? resolve(base, id)
        : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    },
  })
  return compiler.build(candidates)
}

describe('간격 토큰의 0', () => {
  it.each([
    ['inset-0', 'inset'],
    ['min-w-0', 'min-width'],
    ['px-0', 'padding-inline'],
    ['top-0', 'top'],
    ['gap-0', 'gap'],
  ])('%s 가 0px 로 생성된다', async (candidate, property) => {
    const css = await buildUtilities([candidate])

    expect(css).toMatch(
      new RegExp(`\\.${candidate}\\s*\\{\\s*${property}:\\s*var\\(--spacing-0\\)`),
    )
    expect(css).toMatch(/--spacing-0:\s*0px/)
  })

  it('변형 접두가 붙어도 생성된다', async () => {
    const css = await buildUtilities(['after:inset-0'])

    expect(css).toContain('.after\\:inset-0::after')
  })
})
