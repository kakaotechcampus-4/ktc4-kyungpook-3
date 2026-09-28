/** Asia/Seoul 기준 날짜. 날짜 전용 값은 Date로 변환하지 않는다 (D-144). */
export function todayInSeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}
