import type { ComponentPropsWithoutRef } from 'react'
import './skeleton.css'

export type SkeletonVariant = 'text' | 'block' | 'circle'

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** 기본 'text' */
  variant?: SkeletonVariant
  width?: number | string
  height?: number | string
  /** variant='text' 일 때 줄 수. 마지막 줄은 60% 폭 */
  lines?: number
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-11, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md

   §7-11 은 전부 제안값이다 — 캔버스 25장에 스켈레톤이 한 개도 없다. */

/* 선택 면(`bg-surface-selected`) + 1.6s 숨쉬기. `motion-safe:` 가 prefers-reduced-motion 을 건다 —
   줄이기를 켠 사람에게는 규칙 자체가 안 나와서 면만 남는다.
   keyframes 는 같은 폴더의 skeleton.css 에 있다 —
   docs/impl-decision/2026-09-16-skeleton-keyframes-outside-theme.md */
const BASE = 'bg-surface-selected motion-safe:animate-[skeleton-breathe_1.6s_ease-in-out_infinite]'

/** 12px 는 본문 13.5/1.7 한 줄 안에 앉는 뼈대 높이다. height 를 주면 인라인 스타일이 덮는다. */
const TEXT_LINE = 'h-12 rounded-6'

const VARIANT: Record<SkeletonVariant, string> = {
  text: `${TEXT_LINE} w-full`,
  block: 'w-full rounded-12',
  // 원은 지름을 호출부가 준다 — 기본 폭을 주면 height 없이 납작해진다
  circle: 'rounded-999',
}

/** 줄 사이 간격. 실측 근거가 없어 8px 로 제안한다 (§7-11 전체가 제안값이다). */
const LINES_WRAPPER = 'flex flex-col gap-8'

/**
 * 로딩 자리를 지키는 회색 뼈대.
 *
 * **스피너를 만들지 않는다. 그라데이션도 shimmer 이동도 없다** — 불투명도만 움직인다 (§7-11).
 *
 * 접근성: 뼈대 자체는 언제나 `aria-hidden="true"` 다. `aria-busy="true"` 는 **호출부의 컨테이너**가
 * 단다 — 뼈대마다 달면 스크린리더가 같은 말을 줄 수만큼 되풀이한다.
 * `lines` 로 여러 줄을 그릴 때만 이 컴포넌트가 래퍼를 하나 만들고, 그 래퍼가 `aria-hidden` 을 진다.
 *
 * `width` / `height` 는 바깥 요소의 인라인 스타일이 된다. 여러 줄일 때 각 줄의 폭은
 * 100% 이고 마지막 줄만 60% 다.
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  lines,
  className,
  style,
  ...rest
}: SkeletonProps) {
  const boxStyle = { width, height, ...style }

  // lines 는 0 일 수 있다 — && 로 가르지 않는다
  return lines === undefined || variant !== 'text' ? (
    <div
      aria-hidden="true"
      className={[BASE, VARIANT[variant], className].filter(Boolean).join(' ')}
      style={boxStyle}
      {...rest}
    />
  ) : (
    <div
      aria-hidden="true"
      className={[LINES_WRAPPER, className].filter(Boolean).join(' ')}
      style={boxStyle}
      {...rest}
    >
      {Array.from({ length: lines }, (_line, index) => (
        <div
          key={index}
          className={[BASE, TEXT_LINE, index === lines - 1 ? 'w-[60%]' : 'w-full'].join(' ')}
        />
      ))}
    </div>
  )
}
