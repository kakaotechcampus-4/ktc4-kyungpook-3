import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { Skeleton } from '@/shared/ui/skeleton'
import { dateWithWeekday } from '../lib/weekday'
import {
  COLUMNS,
  HEADER,
  LINE_SHAPE,
  MAIN,
  SIDE,
  SUMMARY,
  SUMMARY_ITEM,
  SUMMARY_ITEM_PLAIN,
  SUMMARY_VALUE,
  TITLE,
  TODAY,
} from './frame'
import { HEAD_LINK, SECTION_HEAD, SECTION_TITLE, SectionSkeleton } from './parts'
import type { SectionSkeletonShape } from './parts'

export interface DashboardSkeletonProps {
  /** 역할을 모르면(소속을 아직 받지 못했다) PM 틀이다 */
  isPm: boolean
  /** 서울 오늘 */
  today: string
}

const SUMMARY_LABELS = {
  pm: ['확인 대기', '기한 지남', '7일 이내 마감', '막힌 일'],
  member: ['기한 지남', '7일 이내 마감', '막힌 일'],
}

/** 영역 머리 줄과 본문 뼈대. Dashboard 의 각 영역이 조회를 기다릴 때와 같다 */
function SectionFrame({
  title,
  titleClass = SECTION_TITLE,
  trailing,
  shape,
}: {
  title: string
  titleClass?: string
  trailing?: ReactNode
  shape: SectionSkeletonShape
}) {
  return (
    <div>
      <div className={SECTION_HEAD}>
        <p className={titleClass}>{title}</p>
        {trailing}
      </div>
      <div>
        <SectionSkeleton {...shape} />
      </div>
    </div>
  )
}

/**
 * 대시보드의 라우트 뼈대 (#510). Dashboard 가 모든 조회를 기다릴 때와 같은 틀이다 — 중립 제목 `워크스페이스 현황`, 회의 안내 줄,
 * 오늘 날짜, 요약 칸 이름, 영역 머리 줄과 행 뼈대. 코드를 받은 뒤 화면 안 뼈대(#508)로 바뀌어도 아무것도 움직이지 않는다.
 * 정해진 글자도 자리표시라 스크린리더에서 뺀다. 기다림은 main 의 aria-busy 가 알린다
 */
export function DashboardSkeleton({ isPm, today }: DashboardSkeletonProps) {
  const due = <SectionFrame title="마감 임박" shape={{ rows: 5, kind: 'line' }} />
  return (
    <main aria-busy="true" className={MAIN}>
      <div aria-hidden="true" className={HEADER}>
        <div className="flex flex-col gap-5">
          <p className={TITLE}>워크스페이스 현황</p>
          <div className="flex h-lh items-center text-body">
            <Skeleton width={240} />
          </div>
        </div>
        <p className={TODAY}>{dateWithWeekday(today)}</p>
      </div>

      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className={SUMMARY}>
          {SUMMARY_LABELS[isPm ? 'pm' : 'member'].map((label) => (
            <div key={label} className={`${SUMMARY_ITEM} ${SUMMARY_ITEM_PLAIN}`}>
              <span>{label}</span>
              <span className={SUMMARY_VALUE}>
                <span className="flex h-lh items-center">
                  <Skeleton variant="block" width={18} height={18} />
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div aria-hidden="true" className={COLUMNS}>
        {isPm ? (
          <SectionFrame
            title="확인이 필요한 일"
            titleClass={`${SECTION_TITLE} text-[15px]`}
            trailing={
              <span className={HEAD_LINK}>
                태스크에서 전부 보기
                <Icon name="chevron-right" size={13} />
              </span>
            }
            shape={{ rows: 3, kind: 'review' }}
          />
        ) : (
          due
        )}
        <div className={SIDE}>
          {isPm ? due : null}
          <SectionFrame
            title="최근 반영"
            trailing={
              <Button variant="text" size="sm" disabled className="px-0" tabIndex={-1}>
                전체 로그
              </Button>
            }
            shape={LINE_SHAPE}
          />
        </div>
      </div>
    </main>
  )
}
