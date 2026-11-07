/* 날짜 전용 값(`YYYY-MM-DD`)의 날짜 계산. 태스크 목록(M6)과 대시보드(M7)가 같은 함수로 `7일 이내` 를 판정한다 (D-043, D-144) */

/** `soon`(7일 이내)의 마지막 날은 오늘에서 며칠 뒤인가. 오늘 포함 7개 날짜라 6이다 */
export const SOON_LAST_DAY_OFFSET = 6

/**
 * 날짜 전용 값에 날짜를 더한다. UTC 자정으로만 계산해 실행 환경 시간대와 무관하다 —
 * 서울 날짜 문자열을 받아 서울 날짜 문자열을 돌려준다 (D-144)
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** `soon` 의 마지막 날 — 서울 오늘 + 6일 */
export function soonUntil(today: string): string {
  return addDays(today, SOON_LAST_DAY_OFFSET)
}
