import type { LoadingIndicator } from '@/shared/lib/loading-indicator'
import './deferred-skeleton.css'

/** 로딩을 거쳐 나타난 내용의 150ms 불투명도 전환. `motion-safe:` 라 prefers-reduced-motion 이면 없다 */
export const REVEAL = 'motion-safe:animate-[loading-reveal_150ms_ease-out]'

/** 내용의 바깥 요소에 붙인다. 처음부터 데이터가 있던 자리(로딩을 거치지 않음)에는 전환을 걸지 않는다 */
export function revealClass(indicator: Pick<LoadingIndicator, 'reveal'>): string | undefined {
  return indicator.reveal ? REVEAL : undefined
}
