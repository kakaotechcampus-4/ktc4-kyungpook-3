/* 대시보드 오른쪽 위 날짜. 화면과 라우트 뼈대가 같이 쓴다 — 엔티티를 끌어오지 않는 따로 된 모듈이다 (#510) */
const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const

/** `2026-09-18` → `2026-09-18 금요일`. 날짜 전용 값이라 UTC 로만 요일을 구한다 */
export function dateWithWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${date} ${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`
}
