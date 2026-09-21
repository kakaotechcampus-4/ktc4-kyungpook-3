import type { ReactNode } from 'react'
import { Mascot } from '../mascot/Mascot'
import type { MascotPose } from '../mascot/Mascot'

export interface EmptyStateProps {
  /** 마스코트 포즈. 기본 'idle' — 완료 계열 빈 상태는 호출자가 'squint' 를 준다 */
  pose?: MascotPose
  /** 마스코트 지름. 기본 96 */
  mascotSize?: number
  /** 문구는 호출자가 준다 — 빈 상태 카피를 컴포넌트에 넣지 않는다 */
  title: ReactNode
  description?: ReactNode
  /** 주 액션. 보통 `<Button variant="primary" size="lg">` 하나 */
  action?: ReactNode
  /** 보조 액션. 실측 3장 모두 주 액션 오른쪽에 하나 더 있다 */
  secondaryAction?: ReactNode
  className?: string
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-10, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md */

/** 460px 는 폭 토큰(`--container-*`) 다섯 종 어디에도 없는 실측값이다 */
const CONTAINER = 'flex max-w-[460px] flex-col items-center gap-26 text-center'

const TEXT_BLOCK = 'flex flex-col gap-10'

/* 24px · 1.35 · -0.035em 도, 설명의 14px · 1.8 도 토큰 스케일 밖이다 —
   docs/impl-decision/2026-09-16-empty-state-title-24px.md

   global.css 는 @layer base 안이라 유틸이 h1/p 전역을 이긴다. */
const TITLE = 'text-[24px] leading-[1.35] font-bold tracking-[-0.035em] text-ink'

const DESCRIPTION = 'text-[14px] leading-[1.8] font-normal text-sub'

/** 액션 행 실측 — gap 10 · padding-top 2 */
const ACTIONS = 'flex items-center gap-10 pt-2'

/**
 * 빈 상태 한 벌 — 마스코트 + 제목 + 설명 + 액션 (§7-10).
 *
 * **아이콘 32px 이 아니라 마스코트 96px 이다.** design-system.md §7-15 와 §6 은 "아이콘 32px ·
 * 주 액션 1개"라고 적지만 실측 3장(`EmptyTasks` `EmptyMeetings` `EmptyMessages`)이 전부
 * 마스코트 96px 에 액션 2개다 — §3-⑨ 에 따라 실측을 따른다.
 *
 * **바깥 `main` 의 가운데 정렬(`flex: 1` · `padding: 48px 48px 96px`)은 여기 없다.**
 * 그건 화면의 몫이고 이 컴포넌트는 §7-10 표의 `컨테이너` 한 겹만 그린다.
 *
 * 마스코트에 `label` 을 주지 않는다 — 제목이 이미 같은 말을 한다. 장식이므로 `aria-hidden` 이다.
 *
 * 문구도 버튼도 전부 props 다. 액션이 없으면 행 자체를 그리지 않는다.
 */
export function EmptyState({
  pose = 'idle',
  mascotSize = 96,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const classes = [CONTAINER, className].filter(Boolean).join(' ')

  const hasActions = action !== undefined || secondaryAction !== undefined

  return (
    <div className={classes}>
      <Mascot pose={pose} size={mascotSize} />

      <div className={TEXT_BLOCK}>
        <h1 className={TITLE}>{title}</h1>

        {description === undefined ? null : <p className={DESCRIPTION}>{description}</p>}
      </div>

      {hasActions ? (
        <div className={ACTIONS}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
