import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

export type SelectCardGroupProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>

export interface SelectCardProps extends Omit<
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
  'children' | 'title'
> {
  /** 카드 제목. 문구는 호출자가 준다 */
  title: ReactNode
  description?: ReactNode
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-6, docs/design/canvas/Settings.dc.html 실측 */

/** 카드 사이 14px — `Settings.dc.html` 의 "자동 반영 기준" 섹션 실측 */
const GROUP = 'flex flex-col gap-14'

/* `group` 은 설명문이 선택 상태를 따라가게 하려고 붙인다 — data-state 는 Item 에만 달린다. */
const CARD =
  'group flex w-full items-start gap-13 rounded-16 border bg-surface px-18 py-16 text-left'

/** 선택 테두리는 **먹이 아니다** — m2-design-tokens.md §3-⑥ 가 강조 테두리(`line-strong`)를 채택으로 적었다 */
const CARD_TONE = {
  default:
    'border-line hover:bg-control active:bg-surface-sunken data-[state=checked]:border-line-strong',
  disabled: 'border-line',
}

/* 17px 은 간격 스케일 밖이다 — docs/error/2026-09-16-values-outside-token-scale.md */
const MARK =
  'mt-3 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-999 border'

const MARK_TONE = {
  default: 'border-faint',
  disabled: 'border-line-strong',
}

/** 선택 표식 — 8×8 먹 점 */
const DOT = 'h-8 w-8 rounded-999 bg-ink'

const TEXT = 'flex-1'

const TITLE = 'block text-body font-semibold'

const TITLE_TONE = {
  default: 'text-ink',
  disabled: 'text-dim',
}

/** 선택된 카드만 설명문이 한 단 진해진다 */
const DESCRIPTION = 'block text-caption text-dim group-data-[state=checked]:text-sub'

/**
 * `@radix-ui/react-radio-group` 의 `Root` (§7-0 · §7-6).
 *
 * 방향키 이동과 roving tabindex 는 Radix 가 준다. 라디오 그룹을 손으로 만들지 않는다.
 */
export function SelectCardGroup({ className, children, ...rest }: SelectCardGroupProps) {
  return (
    <RadioGroupPrimitive.Root className={[GROUP, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </RadioGroupPrimitive.Root>
  )
}

/**
 * `Item` 이 카드 전체다 — 카드 안에 따로 라디오 입력을 두지 않는다.
 *
 * **선택 테두리는 `border-line-strong` 이다.** design-system.md §7-12 는 "먹으로 진해진다"고 적지만
 * 실측(`Settings.dc.html`)은 강조 테두리 토큰(`line-strong`)이다 — m2-design-tokens.md §3-⑥.
 *
 * 문구는 전부 props 다 — `title` 은 필수이고 `description` 은 선택이다.
 */
export function SelectCard({ disabled, title, description, className, ...rest }: SelectCardProps) {
  const tone = disabled ? 'disabled' : 'default'

  return (
    <RadioGroupPrimitive.Item
      disabled={disabled}
      className={[CARD, CARD_TONE[tone], className].filter(Boolean).join(' ')}
      {...rest}
    >
      <span className={[MARK, MARK_TONE[tone]].join(' ')}>
        <RadioGroupPrimitive.Indicator className={DOT} />
      </span>

      <span className={TEXT}>
        <span className={[TITLE, TITLE_TONE[tone]].join(' ')}>{title}</span>
        {description ? <span className={DESCRIPTION}>{description}</span> : null}
      </span>
    </RadioGroupPrimitive.Item>
  )
}
