import { useEffect, useState } from 'react'
import { getSplashHoldCount } from '@/shared/lib/splash'

/** 로딩이 이보다 짧으면 스켈레톤을 그리지 않는다 — 빠른 응답에 뼈대가 한두 프레임 번쩍이지 않게 한다 (#508) */
export const LOADING_DELAY_MS = 200

/** 한 번 보인 스켈레톤은 적어도 이만큼 둔다 — 지연을 막 넘긴 응답에 뼈대가 잠깐 보였다 사라지지 않게 한다 (#508) */
export const LOADING_MIN_MS = 400

export interface LoadingIndicatorOptions {
  /** 기본 LOADING_DELAY_MS */
  delayMs?: number
  /** 기본 LOADING_MIN_MS */
  minMs?: number
}

export interface LoadingIndicator {
  /**
   * 내용 대신 로딩 자리를 그린다. 로딩 중이거나, 보인 스켈레톤을 최소 시간 동안 붙잡고 있다.
   * 붙잡는 동안에는 데이터가 와 있어도 내용을 그리지 않는다
   */
  pending: boolean
  /** 스켈레톤을 보인다. `pending` 인데 false 면 같은 높이의 빈 자리다(지연 구간) */
  skeletonVisible: boolean
  /** 로딩을 거쳐 내용이 나타났다 — 내용에 불투명도 전환을 건다. 처음부터 데이터가 있었으면 false 다 */
  reveal: boolean
}

/**
 * 로딩 표시의 시간 규칙 (#508, D-129).
 *
 * 1. 로딩 시작 ~ `delayMs`: 스켈레톤 없이 같은 높이의 빈 자리(`pending` · `!skeletonVisible`).
 * 2. 그 안에 끝나면 스켈레톤 없이 바로 내용.
 * 3. 넘으면 스켈레톤을 보이고, 한 번 보이면 적어도 `minMs` 둔다.
 *
 * 이어받기: 로딩 중으로 처음 그려질 때 라우트 뼈대(또는 스플래시)가 아직 그려져 있으면 — 화면 코드를 받고 막 바뀌는 커밋이다 —
 * 지연 없이 스켈레톤으로 시작한다. 라우트 뼈대 → 빈 자리 → 스켈레톤으로 깜빡이지 않게 한다. 최소 표시는 그때부터 잰다.
 *
 * `useShownAfter`(저장 표시)와 다르다 — 그것은 지연만 하고 최소 표시를 두지 않는다. 끝난 저장을 진행 중으로 남기지 않기 위해서다.
 * 화면 코드·가드를 기다리는 라우트 뼈대(`RouteSkeleton`)에는 쓰지 않는다. 스플래시가 그 뼈대를 잡기 신호로 쓴다.
 */
export function useLoadingIndicator(
  loading: boolean,
  { delayMs = LOADING_DELAY_MS, minMs = LOADING_MIN_MS }: LoadingIndicatorOptions = {},
): LoadingIndicator {
  // 이번 로딩에서 스켈레톤을 보였다 / 보인 스켈레톤의 최소 시간이 아직 남았다
  const [shown, setShown] = useState(() => loading && getSplashHoldCount() > 0)
  const [held, setHeld] = useState(shown)
  // 이 자리가 로딩을 거친 적이 있다. 렌더 중에 맞춘다 — 로딩이 시작된 렌더부터 안다
  const [waited, setWaited] = useState(loading)
  if (loading && !waited) setWaited(true)

  const pending = loading || held
  // 로딩도 최소 표시도 끝났다 — 다음 로딩은 다시 지연부터 잰다
  if (!pending && shown) setShown(false)

  useEffect(() => {
    if (!loading || shown) return
    const timer = setTimeout(() => {
      setShown(true)
      setHeld(true)
    }, delayMs)
    return () => clearTimeout(timer)
  }, [loading, shown, delayMs])

  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => setHeld(false), minMs)
    return () => clearTimeout(timer)
  }, [held, minMs])

  return { pending, skeletonVisible: pending && shown, reveal: waited && !pending }
}
