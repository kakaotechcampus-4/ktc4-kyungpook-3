import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { LoadingIndicator } from '@/shared/lib/loading-indicator'
import './deferred-skeleton.css'

export interface DeferredSkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** `useLoadingIndicator` 의 결과. 이 자리는 `indicator.pending` 일 때만 그린다 */
  indicator: Pick<LoadingIndicator, 'skeletonVisible'>
}

/**
 * 화면 안에서 API 데이터를 기다리는 자리 (#508). 지연 구간에는 뼈대를 숨겨 같은 높이의 빈 자리만 두고, 지연을 넘기면 뼈대를 보인다.
 *
 * - 뼈대(`children`)는 지연 구간에도 그린다 — `visibility: hidden` 이라 높이를 지켜 내용이 와도 레이아웃이 밀리지 않는다.
 * - `aria-busy` 는 빈 자리 구간에도 바로 켠다. 숨기는 것은 자식뿐이고 이 컨테이너는 보이는 채라 접근성 트리에 남는다.
 * - `data-skeleton` 이 지금 상태다(`blank` · `shown`). 숨김 CSS 와 테스트가 이것을 본다.
 */
export function DeferredSkeleton({ indicator, children, ...rest }: DeferredSkeletonProps) {
  return (
    <div aria-busy="true" data-skeleton={indicator.skeletonVisible ? 'shown' : 'blank'} {...rest}>
      {children}
    </div>
  )
}

/**
 * 로딩을 거쳐 나타난 내용을 감싸 그 자식들에 불투명도 전환을 건다. 처음부터 데이터가 있던 자리는 전환하지 않는다.
 * 감싸는 요소는 `display: contents` 라 상자를 만들지 않는다 — 부모의 flex·grid 간격과 배치가 그대로다.
 * 전환 여부와 상관없이 늘 같은 요소다 — 감싸기가 생기고 없어지면 안의 컴포넌트가 다시 마운트되고, 조회가 다시 시작된다.
 * 감싸는 요소는 모두 `data-reveal-box` 를 단다. 바깥 Reveal 의 전환은 안쪽 Reveal 상자(상자가 없어 불투명도가 듣지 않는다)를
 * 건너 실제 내용에 걸린다 — 목록을 기다린 뒤 캐시된 대화가 나타나는 자리처럼 바깥만 로딩을 거친 경우다(REVEAL_TARGETS).
 * 내용의 바깥 요소에 직접 `revealClass` 를 붙일 수 없을 때(다른 컴포넌트, 여러 요소) 쓴다
 */
export function Reveal({
  indicator,
  children,
}: {
  indicator: Pick<LoadingIndicator, 'reveal'>
  children: ReactNode
}) {
  return (
    <div data-reveal-box="" data-reveal={indicator.reveal ? '' : undefined} className="contents">
      {children}
    </div>
  )
}
