import type { CSSProperties } from 'react'
import { GANTT_DAYS, weekOfMonth } from '../lib/taskViews'

/* 간트 표의 틀. GanttView 와 그 뼈대(ViewSkeletons)가 같이 쓴다 — 뼈대는 보기 코드를 나눠 받기 전에 그려져 GanttView 를 가져오지 않는다 */

export const GANTT_LABEL_WIDTH = 252
/* 날짜 칸은 시안 셸 폭(본문 1264px)에서의 칸 폭 48px 아래로 줄이지 않는다. 1024px 에서 균등 분할(32px)은 막대 라벨 잘림을
   3건으로 늘렸다(1440px·1920px 1건, tasks-default 실측). 그보다 좁은 영역에서는 표 영역 안에서 가로로 민다 (D-124) */
export const GANTT_DAY_MIN_WIDTH = 48
export const GANTT_TABLE_MIN_WIDTH = GANTT_LABEL_WIDTH + GANTT_DAYS * GANTT_DAY_MIN_WIDTH + 2
export const GANTT_GRID: CSSProperties = {
  gridTemplateColumns: `repeat(${GANTT_DAYS}, minmax(${GANTT_DAY_MIN_WIDTH}px, 1fr))`,
}

/** 주 머리 — `9월 2주` */
export function weekLabel(monday: string): string {
  return `${Number(monday.slice(5, 7))}월 ${weekOfMonth(monday)}주`
}
