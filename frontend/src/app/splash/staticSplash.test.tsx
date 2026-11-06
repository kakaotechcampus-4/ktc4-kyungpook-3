import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Mascot } from '@/shared/ui/mascot'

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
  it('마스코트가 Mascot 의 정면 + 다이얼(96px)과 같은 그림이다', () => {
    const staticSvg = parse(html).querySelector('#boot-splash .splash__mascot > svg')
    const mascotSvg = parse(
      renderToStaticMarkup(<Mascot pose="idle" dial size={96} />),
    ).querySelector('svg')
    if (staticSvg === null || mascotSvg === null) throw new Error('svg 가 없다')

    expect(svgShape(staticSvg)).toEqual(svgShape(mascotSvg))
  })

  it('탭 제목이 서비스 이름이다', () => {
    expect(parse(html).title).toBe("Manager's Manager")
  })
})
