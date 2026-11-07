import type { LoadingIndicator } from '@/shared/lib/loading-indicator'
import './deferred-skeleton.css'

/** 로딩을 거쳐 나타난 내용의 150ms 불투명도 전환. `motion-safe:` 라 prefers-reduced-motion 이면 없다 */
export const REVEAL = 'motion-safe:animate-[loading-reveal_150ms_ease-out]'

/** 내용의 바깥 요소에 붙인다. 처음부터 데이터가 있던 자리(로딩을 거치지 않음)에는 전환을 걸지 않는다 */
export function revealClass(indicator: Pick<LoadingIndicator, 'reveal'>): string | undefined {
  return indicator.reveal ? REVEAL : undefined
}

/**
 * `Reveal` 의 전환이 걸리는 요소 — deferred-skeleton.css 의 선택자와 같다. 바깥 Reveal 이 로딩을 거쳤으면 안쪽 Reveal 상자
 * (display: contents)를 세 겹까지 건너 실제 내용 요소에 건다. 테스트는 내용이 `closest(REVEAL_TARGETS)` 로 잡히는지 본다
 */
export const REVEAL_TARGETS = [
  '[data-reveal] > :not([data-reveal-box])',
  '[data-reveal] > [data-reveal-box] > :not([data-reveal-box])',
  '[data-reveal] > [data-reveal-box] > [data-reveal-box] > :not([data-reveal-box])',
].join(', ')
