import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeferredSkeleton, Reveal } from './DeferredSkeleton'
import { REVEAL, REVEAL_TARGETS, revealClass } from './reveal'

describe('DeferredSkeleton', () => {
  it('빈 자리 구간에도 aria-busy 를 켜고, 뼈대는 그리되 blank 로 숨긴다', () => {
    render(
      <DeferredSkeleton indicator={{ skeletonVisible: false }} data-testid="slot">
        <div data-testid="bone" />
      </DeferredSkeleton>,
    )
    const slot = screen.getByTestId('slot')
    expect(slot).toHaveAttribute('aria-busy', 'true')
    expect(slot).toHaveAttribute('data-skeleton', 'blank')
    expect(screen.getByTestId('bone')).toBeInTheDocument()
  })

  it('지연을 넘기면 shown 이다', () => {
    render(
      <DeferredSkeleton indicator={{ skeletonVisible: true }} data-testid="slot" className="py-18">
        <div />
      </DeferredSkeleton>,
    )
    expect(screen.getByTestId('slot')).toHaveAttribute('data-skeleton', 'shown')
    expect(screen.getByTestId('slot')).toHaveClass('py-18')
  })

  it('전환 클래스는 로딩을 거쳐 나타난 내용에만 붙는다', () => {
    expect(revealClass({ reveal: true })).toBe(REVEAL)
    expect(revealClass({ reveal: false })).toBeUndefined()
  })

  it('Reveal 은 늘 상자 없는 같은 요소이고, 로딩을 거친 내용에만 전환 표시를 단다', () => {
    const { container, rerender } = render(
      <Reveal indicator={{ reveal: false }}>
        <p>내용</p>
      </Reveal>,
    )
    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass('contents')
    expect(wrapper).not.toHaveAttribute('data-reveal')
    rerender(
      <Reveal indicator={{ reveal: true }}>
        <p>내용</p>
      </Reveal>,
    )
    // 같은 요소다 — 안의 내용이 다시 마운트되지 않는다
    expect(container.firstElementChild).toBe(wrapper)
    expect(wrapper).toHaveAttribute('data-reveal')
  })

  it('바깥 Reveal 만 로딩을 거쳤으면 안쪽 Reveal 상자를 건너 실제 내용에 전환이 걸린다', () => {
    render(
      <Reveal indicator={{ reveal: true }}>
        <Reveal indicator={{ reveal: false }}>
          <p>캐시된 내용</p>
        </Reveal>
      </Reveal>,
    )
    const target = screen.getByText('캐시된 내용').closest(REVEAL_TARGETS)
    expect(target?.tagName).toBe('P')
  })

  it('전환이 없으면 안쪽 내용은 대상이 아니다', () => {
    render(
      <Reveal indicator={{ reveal: false }}>
        <Reveal indicator={{ reveal: false }}>
          <p>캐시된 내용</p>
        </Reveal>
      </Reveal>,
    )
    expect(screen.getByText('캐시된 내용').closest(REVEAL_TARGETS)).toBeNull()
  })

  it('CSS 의 전환 선택자가 REVEAL_TARGETS 와 같다', () => {
    // 테스트는 CSS 를 처리하지 않는다(vite css: false) — 파일을 글자로 읽는다
    const css = readFileSync(resolve(import.meta.dirname, 'deferred-skeleton.css'), 'utf8')
    const rule = /@media \(prefers-reduced-motion: no-preference\) \{\s*([^{]+)\{/.exec(css)?.[1]
    const selectors = (rule ?? '').split(',').map((part) => part.trim())
    expect(selectors).toEqual(REVEAL_TARGETS.split(', '))
  })
})
