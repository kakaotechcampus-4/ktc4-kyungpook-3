import { useCompactScreen } from '@/shared/lib/compact-screen'
import { ASIDE, ASIDE_TITLE, COMPOSE_LINK, DETAIL, SCREEN } from './frame'
import { InboxListSkeleton, ReviewSkeleton, ThreadSkeleton } from './MessageSkeletons'

/** 라우트 뼈대는 바로 보인다 — 지연 규칙(#508)은 화면이 데이터를 기다릴 때의 것이다 */
const SHOWN = { skeletonVisible: true }

export interface MessageInboxSkeletonProps {
  /** 역할을 모르면 PM 틀이다 */
  isPm: boolean
  /** 고른 대화(`messages/threads/:id`)를 연다 — 상세 자리가 대화 모양이다 */
  thread: boolean
}

/**
 * 메시지 화면의 라우트 뼈대 (#510). MessageInbox 가 목록을 기다릴 때와 같은 틀이다 — 왼쪽 목록 칸(제목 · PM 의 `새 재촉`·`새 대화` · 목록 뼈대)과
 * 오른쪽 상세 칸(PM 의 기본 선택은 보낼 메시지 모양, 팀원·대화 주소는 대화 모양). 휴대폰 목록 칸은 목록만이다.
 * 휴대폰에서 상세를 바로 여는 주소는 셸을 걷은 전체 화면이라 부르는 쪽이 일반 뼈대를 쓴다(이 뼈대를 그리지 않는다).
 * 정해진 글자도 자리표시라 스크린리더에서 뺀다. 기다림은 main 의 aria-busy 가 알린다
 */
export function MessageInboxSkeleton({ isPm, thread }: MessageInboxSkeletonProps) {
  const pane = useCompactScreen() ? 'list' : 'both'
  return (
    <main aria-busy="true" className={SCREEN[pane]}>
      <div aria-hidden="true" className={ASIDE[pane]}>
        <div className="flex items-center justify-between gap-8 pr-4">
          <p className={ASIDE_TITLE[pane]}>메시지</p>
          {isPm ? (
            <div className="flex items-center gap-4">
              <span className={COMPOSE_LINK}>새 재촉</span>
              <span className={COMPOSE_LINK}>새 대화</span>
            </div>
          ) : null}
        </div>
        <InboxListSkeleton indicator={SHOWN} pm={isPm} />
      </div>
      {pane === 'both' ? (
        <div aria-hidden="true" className={DETAIL}>
          {thread || !isPm ? (
            <ThreadSkeleton indicator={SHOWN} />
          ) : (
            <ReviewSkeleton indicator={SHOWN} />
          )}
        </div>
      ) : null}
    </main>
  )
}
