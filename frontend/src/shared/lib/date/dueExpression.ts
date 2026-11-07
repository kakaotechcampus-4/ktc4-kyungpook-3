import { addDays } from './days'

/*
 * 승인의 `dueRaw`(회의에서 한 말 그대로)를 날짜로 읽는다. 확실히 하나로 정해지는 표현만 읽고 나머지는 null 이다 —
 * 틀린 날짜를 채우는 것이 채우지 않는 것보다 나쁘다. AI 도 같은 이유로 규칙 기반 날짜 계산을 지웠다
 * (ai/docs/basis_for_decision/ai/2026-11-02-evidence-status.md). 모든 날짜는 서울 날짜 문자열이고 UTC 자정으로만 계산한다
 */

/** 월요일부터. 주의 시작이 월요일이라 `이번 주`·`다음 주` 의 날짜가 이 순서의 칸 번호로 정해진다 */
const WEEKDAYS = '월화수목금토일'

/** 말 끝에 붙어도 뜻이 바뀌지 않는 조사. 긴 것부터 떼어 본다. `전`·`쯤`·`중`·`이내` 는 날짜를 하나로 정하지 않아 없다 */
const TRAILING_PARTICLES = ['까지는', '까지', '에는', '에'] as const

const MAX_DAYS_AFTER = 365

/** 지난 `M월 D일` 을 내년으로 읽는 범위. 12월 회의의 `3월 말` 정도까지다 */
const YEAR_TURN_WINDOW_DAYS = 92

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  return [year, month, day]
}

/** 월요일 0 … 일요일 6 */
function weekdayIndex(date: string): number {
  const [year, month, day] = parts(date)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

/** 달력에 있는 날이면 `YYYY-MM-DD`, 없으면(2월 30일 등) null */
function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  return date.toISOString().slice(0, 10)
}

function weekdayOfWeek(base: string, weeksAfter: number, weekday: string): string {
  const monday = addDays(base, -weekdayIndex(base))
  return addDays(monday, weeksAfter * 7 + WEEKDAYS.indexOf(weekday))
}

type Resolve = (match: RegExpMatchArray, base: string) => string | null

/** 공백을 지운 표현 전체가 맞아야 한다. 결과가 기준일보다 앞이면 `resolveDueExpression` 이 버린다 */
const RULES: ReadonlyArray<readonly [RegExp, Resolve]> = [
  [/^오늘$/, (_, base) => base],
  [/^내일$/, (_, base) => addDays(base, 1)],
  [/^모레$/, (_, base) => addDays(base, 2)],
  [/^이번주([월화수목금토일])요일$/, ([, weekday], base) => weekdayOfWeek(base, 0, weekday)],
  [/^다음주([월화수목금토일])요일$/, ([, weekday], base) => weekdayOfWeek(base, 1, weekday)],
  [
    /^(\d{1,3})일(?:뒤|후)$/,
    ([, days], base) => {
      const count = Number(days)
      return count >= 1 && count <= MAX_DAYS_AFTER ? addDays(base, count) : null
    },
  ],
  [
    /^(\d{1,2})월(\d{1,2})일$/,
    ([, m, d], base) => {
      const [year, baseMonth, baseDay] = parts(base)
      const month = Number(m)
      const day = Number(d)
      const passed = month < baseMonth || (month === baseMonth && day < baseDay)
      if (!passed) return calendarDate(year, month, day)
      // 지난 날짜를 내년으로 읽는 것은 연말에 새해 초를 말한 때만 확실하다. `9월 1일`(9/15 회의)은 내년이 아니라 착오다
      const nextYear = calendarDate(year + 1, month, day)
      return nextYear !== null && nextYear <= addDays(base, YEAR_TURN_WINDOW_DAYS) ? nextYear : null
    },
  ],
  [
    /^(\d{1,2})일$/,
    ([, d], base) => {
      const [year, month, baseDay] = parts(base)
      const day = Number(d)
      if (day >= baseDay) return calendarDate(year, month, day)
      return month === 12 ? calendarDate(year + 1, 1, day) : calendarDate(year, month + 1, day)
    },
  ],
]

function withoutParticle(text: string): string {
  const particle = TRAILING_PARTICLES.find((candidate) => text.endsWith(candidate))
  return particle === undefined ? text : text.slice(0, -particle.length)
}

/**
 * 마감 표현을 기준일(회의 날짜) 기준의 날짜로 읽는다. 둘 다 `YYYY-MM-DD` 다.
 * 확실한 표현이 아니거나 결과가 기준일보다 앞이면 null 이다
 */
export function resolveDueExpression(raw: string, baseDate: string): string | null {
  const text = withoutParticle(raw.replace(/\s+/g, ''))
  for (const [pattern, resolve] of RULES) {
    const match = text.match(pattern)
    if (match === null) continue
    const date = resolve(match, baseDate)
    return date !== null && date >= baseDate ? date : null
  }
  return null
}

/** `2026-09-21` → `9/21(월)` */
export function formatMonthDayWeekday(date: string): string {
  const [, month, day] = parts(date)
  return `${month}/${day}(${WEEKDAYS[weekdayIndex(date)]})`
}
