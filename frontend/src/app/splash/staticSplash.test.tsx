import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Mascot } from '@/shared/ui/mascot'
import { SPLASH_INTERVAL_MS, SPLASH_RECORD_KEY, isSplashDue } from '@/shared/lib/splash'
import { FADE_MS, QUICK_FADE_MS } from './splashMachine'
import { SPLASH_SIZE } from './splashSize'

/*
 * index.html 의 정적 스플래시는 JS 보다 먼저 그리려고 Mascot 을 손으로 옮겨 둔 사본이다 (#430).
 * React 가 같은 자리를 이어받을 때 모양이 튀지 않으려면 둘이 같아야 한다. 마스코트를 고치면 이 테스트가 사본을 다시 맞추라고 알린다.
 */

const html = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')

interface Shape {
  tag: string
  attributes: Record<string, string>
  children: Shape[]
}

/**
 * 요소 트리를 태그·속성·자식으로 편다. clip-path id 는 렌더마다 달라 자리표시로 바꾼다.
 * style 의 공백은 prettier 가 index.html 을 다듬으며 넣는 것이라 뺀다
 */
function shape(element: Element, ids: Map<string, string>): Shape {
  const attributes: Record<string, string> = {}
  for (const { name, value } of element.attributes) {
    if (name === 'id') attributes[name] = ids.get(value) ?? value
    else if (name === 'style') attributes[name] = value.replace(/\s+/g, '').replace(/;$/, '')
    else
      attributes[name] = value.replace(
        /url\(#([^)]+)\)/,
        (_match, id: string) => `url(#${ids.get(id)})`,
      )
  }
  return {
    tag: element.tagName.toLowerCase(),
    attributes,
    children: [...element.children].map((child) => shape(child, ids)),
  }
}

function svgShape(svg: Element): Shape {
  const ids = new Map(
    [...svg.querySelectorAll('[id]')].map((element, index) => [element.id, `id-${index}`]),
  )
  return shape(svg, ids)
}

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'text/html')
}

describe('index.html 정적 스플래시', () => {
  it('마스코트가 SplashHost 가 그리는 Mascot 정면 + 다이얼과 같은 그림·크기다', () => {
    const staticSvg = parse(html).querySelector('#boot-splash .splash__mascot > svg')
    const mascotSvg = parse(
      renderToStaticMarkup(<Mascot pose="idle" dial size={SPLASH_SIZE.mascot} />),
    ).querySelector('svg')
    if (staticSvg === null || mascotSvg === null) throw new Error('svg 가 없다')

    expect(svgShape(staticSvg)).toEqual(svgShape(mascotSvg))
  })

  it('CSS 의 마스코트 상자·간격·워드마크 크기가 SplashHost 와 같다', () => {
    const style = document.createElement('style')
    style.textContent = parse(html).querySelector('style')?.textContent ?? ''
    document.head.append(style)
    document.body.innerHTML = parse(html).body.innerHTML
    const computed = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) throw new Error(`${selector} 가 없다`)
      return getComputedStyle(element)
    }

    expect(computed('.splash__mascot').width).toBe(`${SPLASH_SIZE.mascot}px`)
    expect(computed('.splash__mascot').height).toBe(`${SPLASH_SIZE.mascot}px`)
    expect(computed('.splash__group').gap).toBe(`${SPLASH_SIZE.gap}px`)
    expect(computed('.splash__word').fontSize).toBe(`${SPLASH_SIZE.wordmark}px`)
    style.remove()
  })

  it('사라짐 애니메이션이 덮개를 걷는 시각(FADE_MS)과 같은 길이다', () => {
    // 짧으면 다 사라진 판이 남아 있고, 길면 사라지는 도중에 판이 뚝 끊긴다 (#506)
    const style = parse(html).querySelector('style')?.textContent ?? ''
    const fade = /\.splash\[data-phase='leave'\]\s*\{[^}]*animation:\s*splash-out\s+([\d.]+)s/.exec(
      style,
    )
    if (fade === null) throw new Error('splash-out 애니메이션이 없다')
    expect(Number(fade[1]) * 1000).toBe(FADE_MS)
  })

  it('설치한 앱의 짧은 사라짐(data-fade=quick)이 QUICK_FADE_MS 와 같은 길이다 (#510)', () => {
    const style = parse(html).querySelector('style')?.textContent ?? ''
    const fade =
      /\.splash\[data-phase='leave'\]\[data-fade='quick'\]\s*\{[^}]*animation-duration:\s*([\d.]+)s/.exec(
        style,
      )
    if (fade === null) throw new Error('quick 사라짐이 없다')
    expect(Number(fade[1]) * 1000).toBe(QUICK_FADE_MS)
  })

  it('탭 제목이 서비스 이름이다', () => {
    expect(parse(html).title).toBe("Manager's Manager")
  })
})

/*
 * <head> 인라인 스크립트 (#510). 첫 페인트 전에 localStorage 를 동기로 읽어 12시간 안이면 <html> 에 표시를 붙인다.
 * JS 번들보다 먼저 돌아야 해서 splashRecord.ts 를 쓰지 못하고 같은 판정을 옮겨 둔 사본이다. 둘이 같은지 여기서 본다
 */
describe('index.html 스플래시 빈도 판정', () => {
  const NOW = Date.UTC(2026, 10, 8, 3, 0, 0)
  const HOUR = 60 * 60 * 1000
  const headScript = [...parse(html).head.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent)
    .join('\n')

  function runHeadScript({ standalone = false }: { standalone?: boolean } = {}) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)' && standalone,
      media: query,
    }))
    document.documentElement.removeAttribute('data-splash')
    // index.html 의 스크립트를 그대로 돌려 본다
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(headScript) as () => void
    run()
    return document.documentElement.getAttribute('data-splash')
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('data-splash')
  })

  it('키가 splashRecord.ts 와 같다', () => {
    expect(headScript).toContain(`'${SPLASH_RECORD_KEY}'`)
  })

  it.each([
    ['기록 없음', null],
    ['11시간 전', NOW - 11 * HOUR],
    ['12시간 직전', NOW - SPLASH_INTERVAL_MS + 1],
    ['딱 12시간', NOW - SPLASH_INTERVAL_MS],
    ['13시간 전', NOW - 13 * HOUR],
    ['앞날', NOW + HOUR],
    ['방금', NOW],
  ])('%s: 건너뛰기 판정이 isSplashDue 와 같다', (_name, shownAt) => {
    if (shownAt !== null) window.localStorage.setItem(SPLASH_RECORD_KEY, String(shownAt))
    expect(runHeadScript() === 'skip').toBe(!isSplashDue(NOW))
  })

  it('12시간 안이면 skip, 설치한 앱이면 quick 이다', () => {
    window.localStorage.setItem(SPLASH_RECORD_KEY, String(NOW - 11 * HOUR))
    expect(runHeadScript()).toBe('skip')
    expect(runHeadScript({ standalone: true })).toBe('quick')
  })

  it('13시간이 지났으면 표시가 없다 — 전체 스플래시다', () => {
    window.localStorage.setItem(SPLASH_RECORD_KEY, String(NOW - 13 * HOUR))
    expect(runHeadScript()).toBeNull()
    expect(runHeadScript({ standalone: true })).toBeNull()
  })

  it('저장소를 읽지 못하면 표시 없이 지나간다 — 매번 보인다', () => {
    window.localStorage.setItem(SPLASH_RECORD_KEY, String(NOW - HOUR))
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    try {
      expect(runHeadScript()).toBeNull()
    } finally {
      blocked.mockRestore()
    }
  })

  it('skip 이면 CSS 가 정적 판을 그리지 않는다', () => {
    const style = document.createElement('style')
    style.textContent = parse(html).querySelector('style')?.textContent ?? ''
    document.head.append(style)
    document.body.innerHTML = parse(html).body.innerHTML
    const splash = document.getElementById('boot-splash')
    if (splash === null) throw new Error('정적 판이 없다')

    expect(getComputedStyle(splash).display).not.toBe('none')
    document.documentElement.setAttribute('data-splash', 'skip')
    expect(getComputedStyle(splash).display).toBe('none')
    document.documentElement.setAttribute('data-splash', 'quick')
    expect(getComputedStyle(splash).display).not.toBe('none')
    style.remove()
    document.body.innerHTML = ''
  })
})
