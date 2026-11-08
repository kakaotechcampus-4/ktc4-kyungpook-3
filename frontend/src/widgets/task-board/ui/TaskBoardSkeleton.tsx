import { Icon } from '@/shared/ui/icon'
import { SegmentedFrame } from '@/shared/ui/segmented/SegmentedFrame'
import { boardTabs, readBoardQuery } from '../lib/taskBoard'
import { sortLabel } from '../lib/taskSort'
import { TASK_VIEWS, VIEW_LABEL, mondayOf, monthOf, readViewQuery } from '../lib/taskViews'
import {
  COLUMN,
  DESCRIPTION,
  DESCRIPTIONS,
  HEADER,
  PAGE,
  PERIOD_LABEL,
  TAB,
  TAB_LABEL,
  TAB_LIST,
  TITLE,
  TOOLBAR,
  TRIGGER,
  TRIGGER_BORDER,
  dueFilterLabel,
} from './frame'
import { TaskViewSkeleton } from './ViewSkeletons'

export interface TaskBoardSkeletonProps {
  /** 주소의 검색 문자열 — 보기·탭·조건이 화면과 같은 틀을 고른다 */
  search: string
  /** 역할을 모르면 PM 틀이다 */
  isPm: boolean
  /** 서울 오늘 — 캘린더 달·간트 주를 정한다 */
  today: string
}

/** 고르기 버튼(FilterSelect)의 닫힌 모양. 담당자 이름은 받아야 알아 `담당자 전체` 로 둔다 */
function Trigger({ label, bordered = false }: { label: string; bordered?: boolean }) {
  return (
    <span className={`${TRIGGER} ${TRIGGER_BORDER[bordered ? 'line' : 'none']}`}>
      {label}
      <Icon name="chevron-down" size={14} className="text-dim" />
    </span>
  )
}

/**
 * 태스크 화면의 라우트 뼈대 (#510). TaskBoard 가 태스크를 기다릴 때와 같은 틀이다 — 제목·설명, 보기 고르기, 리스트의 탭 줄과 조건,
 * 보드의 조건 줄, 보기마다의 뼈대(#508 TaskViewSkeleton). 주소의 보기·탭·조건을 그대로 읽어 같은 모양을 고른다.
 * 정해진 글자도 자리표시라 스크린리더에서 뺀다. 기다림은 main 의 aria-busy 가 알린다
 */
export function TaskBoardSkeleton({ search, isPm, today }: TaskBoardSkeletonProps) {
  const params = new URLSearchParams(search)
  const view = readViewQuery(params)
  const query = readBoardQuery(params, isPm)
  const month = view.month ?? monthOf(today)
  const from = view.from ?? mondayOf(today)
  const isList = view.view === 'list'
  const listCards = !isPm
    ? 'none'
    : query.tab === 'all'
      ? 'mixed'
      : query.tab === 'needs_review'
        ? 'only'
        : 'none'

  return (
    <main aria-busy="true" className={PAGE[view.view]}>
      <div aria-hidden="true" className={COLUMN[view.view]}>
        <div className={HEADER}>
          <div className="flex flex-col gap-5">
            <p className={TITLE}>태스크</p>
            <p className={DESCRIPTION}>{DESCRIPTIONS[view.view](isPm)}</p>
          </div>
          <SegmentedFrame
            items={TASK_VIEWS.map((each) => ({ value: each, label: VIEW_LABEL[each] }))}
            selected={view.view}
          />
        </div>
        {isList ? (
          <div className="flex flex-col gap-28">
            <div className={TOOLBAR}>
              <div className={TAB_LIST}>
                {boardTabs(isPm).map((tab) => (
                  <span
                    key={tab}
                    data-selected={tab === query.tab ? '' : undefined}
                    className={TAB}
                  >
                    {TAB_LABEL[tab]}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-8">
                <Trigger label={dueFilterLabel(query.due)} />
                <Trigger label="담당자 전체" />
                <Trigger label={sortLabel(view.sort)} />
              </div>
            </div>
            <div className="flex flex-col gap-28">
              <div>
                <TaskViewSkeleton view="list" listCards={listCards} month={month} from={from} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {view.view === 'board' ? (
              <div className="flex items-center gap-8 max-md:flex-wrap">
                <Trigger label="담당자 전체" bordered />
                <Trigger label={PERIOD_LABEL[view.period]} bordered />
                <Trigger label={sortLabel(view.sort)} bordered />
              </div>
            ) : null}
            <div className="flex flex-col gap-20">
              <div>
                <TaskViewSkeleton view={view.view} month={month} from={from} />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
