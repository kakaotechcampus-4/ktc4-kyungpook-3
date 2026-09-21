import type { ComponentPropsWithoutRef } from 'react'

export type PanelProps = ComponentPropsWithoutRef<'div'>

/* 근거: m2-design-tokens.md §7-4 — 눌린 면 · 테두리 없음 · 반경 12 · padding 18/20 · 내부 gap 7 */

/** gap-7 이 걸리려면 flex 여야 한다. 근거 블록은 출처 / 인용 / 보충 세 줄이 세로로 쌓인다. */
const PANEL = 'flex flex-col gap-7 rounded-12 bg-surface-sunken px-20 py-18'

/**
 * 눌린 면 블록 — 태스크 카드 안의 "근거" 자리.
 *
 * **테두리도 그림자도 없다.** 깊이는 `bg-surface-sunken` 한 단으로만 낸다 (§3-④).
 * **좌측 액센트 줄무늬를 넣지 않는다** — design-system.md §7-4 가 명시적으로 없다고 적는다.
 *
 * 안쪽 글자 단(출처 mono 11 / 인용 13.5 / 보충 12.5)은 호출부가 정한다.
 */
export function Panel({ className, children, ...rest }: PanelProps) {
  const classes = [PANEL, className].filter(Boolean).join(' ')

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
