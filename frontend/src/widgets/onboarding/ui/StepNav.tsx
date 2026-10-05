import type { ReactNode } from 'react'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'

export interface StepNavProps {
  /** `이전 단계` 가 갈 곳. null·없으면 화살표를 비활성으로 둔다 (1단계) */
  previous?: string | null
  /** `다음 단계`. 없으면 화살표를 비활성으로 둔다 — 1단계(지금 단계)에는 할 일이 없다 */
  onNext?: () => void
  /** 저장 중. 두 화살표 모두 막는다 */
  disabled?: boolean
  /** 연동 상태를 받기 전처럼 `다음 단계` 가 할 일을 아직 모를 때 오른쪽만 막는다 */
  nextDisabled?: boolean
}

/* ExitLink 화살표와 같은 36px 정사각 · 반경 9 · text-sub. 비활성 색은 Button ghost 와 같다 */
const ARROW =
  'inline-flex h-36 w-36 items-center justify-center rounded-9 text-sub enabled:hover:bg-control enabled:active:bg-line disabled:text-line-strong'

/**
 * 카드 아래 `‹ n / 4 ›`. 쓸 수 없는 화살표는 지우지 않고 비활성으로 둔다 — 카운터가 움직이지 않는다.
 * `이전 단계` 는 공통 이동 관문을 탄다 — 저장하지 않은 입력이 있으면 이탈 확인을 거친다.
 * 캔버스는 오른쪽 `이전`/`다음` 글자 버튼이지만 사용자가 카운터 양옆 꺾쇠(chevron) 화살표로 바꿨다
 * (docs/impl-decision/2026-09-28-onboarding-layout.md, 2026-09-29).
 */
export function StepNav({
  previous,
  onNext,
  disabled = false,
  nextDisabled = false,
  children,
}: StepNavProps & { children: ReactNode }) {
  const navigate = useGuardedNavigate()
  const to = previous ?? null
  return (
    <nav aria-label="단계 이동" className="flex items-center gap-8">
      <button
        type="button"
        aria-label="이전 단계"
        className={ARROW}
        disabled={disabled || to === null}
        onClick={() => {
          if (to !== null) navigate(to)
        }}
      >
        <Icon name="chevron-left" size={18} />
      </button>
      {children}
      <button
        type="button"
        aria-label="다음 단계"
        className={ARROW}
        disabled={disabled || nextDisabled || onNext === undefined}
        onClick={onNext}
      >
        <Icon name="chevron-right" size={18} />
      </button>
    </nav>
  )
}
