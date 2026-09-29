import { isMatch } from 'date-fns/isMatch'

/* D-144. timestamp 는 한국 시간으로 보여 준다. `YYYY-MM-DD` 날짜 전용 값은 Date 로 바꾸지 않는다 —
   바꾸는 순간 실행 환경 시간대에 따라 하루가 밀린다. */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const seoulFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

interface SeoulParts {
  date: string
  time: string
}

function seoulParts(timestamp: string): SeoulParts | null {
  const instant = new Date(timestamp)
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Map(
    seoulFormatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  )
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

/** timestamp 를 한국 시간 `YYYY-MM-DD HH:mm` 로 보여 준다. 읽을 수 없으면 빈 문자열이다 */
export function formatSeoulDateTime(timestamp: string): string {
  const parts = seoulParts(timestamp)
  return parts === null ? '' : `${parts.date} ${parts.time}`
}

/** timestamp 가 한국 시간으로 며칠인지. 마감일 같은 날짜 전용 값과 비교할 때 쓴다 */
export function seoulDateOf(timestamp: string): string | null {
  return seoulParts(timestamp)?.date ?? null
}

/** `YYYY-MM-DD` 모양이고 달력에 있는 날인지 */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value) && isMatch(value, 'yyyy-MM-dd')
}

/** 날짜 전용 값을 시간대 변환 없이 그대로 돌려준다. 형식이 틀리면 null 이다 */
export function readDateOnly(value: string | null | undefined): string | null {
  return typeof value === 'string' && isDateOnly(value) ? value : null
}
