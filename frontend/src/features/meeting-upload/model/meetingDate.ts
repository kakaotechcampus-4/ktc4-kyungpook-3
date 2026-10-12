import { seoulDateOf, seoulMidnightIso, todayInSeoul } from '@/shared/lib/date'

/** 파일의 마지막 수정 시각이 서울로 며칠인지. 회의 날짜 칸의 기본값이다 (D-144) */
export function fileSeoulDate(lastModified: number): string {
  const instant = new Date(lastModified)
  if (Number.isNaN(instant.getTime())) return todayInSeoul()
  return seoulDateOf(instant.toISOString()) ?? todayInSeoul()
}

/**
 * 보낼 회의 시각. 날짜를 고치지 않았으면 파일의 원래 시각이고, 고쳤으면 고른 날의 서울 자정이다.
 * 「고쳤는가」는 칸의 값이 파일의 서울 날짜와 다른가로 본다 — 바꿨다 되돌리면 원래 시각이다.
 */
export function toStartedAt(lastModified: number, date: string): string {
  if (date === fileSeoulDate(lastModified)) return new Date(lastModified).toISOString()
  const midnight = seoulMidnightIso(date)
  if (midnight === null) throw new Error(`invalid meeting date ${date}`)
  return midnight
}
