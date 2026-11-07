import type { TaskTab } from '@/entities/task'
import { DUE_CONDITIONS } from '../lib/taskBoard'
import type { DueCondition } from '../lib/taskBoard'
import type { BoardPeriod, TaskView, ViewQuery } from '../lib/taskViews'

/* 태스크 화면 틀. 화면(TaskBoard · ViewControls)과 라우트 뼈대(TaskBoardSkeleton)가 같이 쓴다 (#510) */

/* Tasks 시안 — main 패딩 48/48/72, 블록 사이 28px.
 * 리스트·보드는 상세·확인 필요 상세와 같이 960px 이하로 가운데에 둔다. 둘을 오갈 때 제목·탭·도구줄이 움직이지 않는다 (#466).
 * 캘린더·간트는 날짜 칸이 넓어야 해서 시안 셸 폭을 유지한다.
 * 폭 768px 미만은 대시보드(H-2)와 같은 패딩 12/20/32 다 (D-180) */
export const PAGE_BASE =
  'mx-auto flex w-full flex-1 justify-center px-48 pt-48 pb-72 max-md:px-20 max-md:pt-12 max-md:pb-32'
export const PAGE: Record<TaskView, string> = {
  list: `${PAGE_BASE} max-w-[960px]`,
  board: `${PAGE_BASE} max-w-[960px]`,
  calendar: `${PAGE_BASE} max-w-shell`,
  gantt: `${PAGE_BASE} max-w-shell`,
}
/* 블록 사이 — 리스트 28px, 보드 22px(TasksBoard), 캘린더·간트 20px(TasksCalendar·TasksGantt) */
export const COLUMN: Record<TaskView, string> = {
  list: 'flex w-full flex-col gap-28',
  board: 'flex w-full flex-col gap-22',
  calendar: 'flex w-full flex-col gap-20',
  gantt: 'flex w-full flex-col gap-20',
}
export const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'
export const DESCRIPTION = 'text-body text-sub'
export const TOOLBAR = 'flex flex-wrap items-center justify-between gap-16'
export const TAB_LIST = 'inline-flex gap-[17px]'
export const TAB =
  'inline-flex h-32 items-center gap-7 border-b-2 border-transparent px-3 text-control font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
export const HEADER =
  'flex items-end justify-between gap-24 max-md:flex-col max-md:items-start max-md:gap-16'
export const TAB_SELECTED = 'border-ink text-ink'

export const TAB_LABEL: Record<TaskTab, string> = {
  all: '전체',
  needs_review: '확인 필요',
  in_progress: '진행 중',
  done: '완료',
}

export const DESCRIPTIONS: Record<ViewQuery['view'], (isPm: boolean) => string> = {
  list: (isPm) =>
    isPm ? '담당자별로 걸러 보고, 준비된 태스크를 확인하세요.' : '팀의 태스크를 확인하세요.',
  board: () => '승인이 끝난 일만 올라옵니다 — Notion 보드와 같은 상태예요.',
  calendar: () => '마감일 기준입니다. 날짜가 없는 일은 아래 칸에 모아 뒀어요.',
  gantt: () => '간트차트로 일정을 한 눈에 볼 수 있어요.',
}

/* 리스트 시안은 테두리가 투명이고(`1px solid transparent`), 보드 시안만 `#E8E8E8` 테두리가 있다.
   높이는 두 시안 모두 `height 32; min-height 36` 이라 36px 로 그려진다 */
export const TRIGGER =
  'inline-flex h-32 min-h-36 items-center gap-7 rounded-9 border bg-surface px-12 text-caption font-semibold text-ink hover:bg-surface-sunken'
export const TRIGGER_BORDER = { none: 'border-transparent', line: 'border-line' } as const

export const DUE_LABEL: Record<DueCondition, string> = {
  overdue: '기한 지남',
  soon: '7일 안에 마감',
  blocked: '막힘',
}

export const PERIOD_LABEL: Record<BoardPeriod, string> = { all: '전체 기간', month: '이번 달' }

/** 마감 조건 고르기의 닫힌 글자 — 고른 것이 없으면 `마감 전체`, 있으면 고른 조건을 잇는다 */
export function dueFilterLabel(value: readonly DueCondition[]): string {
  return value.length === 0
    ? '마감 전체'
    : DUE_CONDITIONS.filter((condition) => value.includes(condition))
        .map((condition) => DUE_LABEL[condition])
        .join(' · ')
}
