import { useId, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MinutesAttendee } from '@/entities/minutes'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { fitAttendees } from '../lib/fitAttendees'

/* Meetings 캔버스 실측 — 칩 22px · 반경 6 · 좌우 8, 11.5px 굵게 · 보조색. 줄 안에서 접히지 않는다 */
export const CHIP =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-control px-8 text-meta leading-none font-semibold whitespace-nowrap text-sub'
/**
 * 참석자 줄 — 칩 한 줄 높이(22)로 고정한다. 회의록 · 목록 요약 머리 · 뼈대가 모두 이 높이라, 참석자가 몇 명이든 폭이 얼마든
 * 머리 아래 탭 줄이 같은 자리다 (UX1-M03)
 */
export const ATTENDEE_ROW = 'flex h-22 min-w-[0px] items-center gap-6'
const MORE = `${CHIP} cursor-pointer hover:text-ink data-[state=open]:text-ink`
/* 재는 칸 — 이름 칩 전부와 `+전체 인원` 칩을 한 줄로 늘어놓는다. 줄 크기 안에 잘리고 보이지 않으며 읽히지도 않는다.
   글자는 ::before 의 content 로만 그린다 — 화면 글자(textContent)가 두 번 생기지 않는다 */
const MEASURE_BOX = 'pointer-events-none invisible absolute inset-0 overflow-hidden'
const MEASURE_CHIP = `${CHIP} before:content-[attr(data-label)]`

/**
 * 회의록의 참석자 — 한 줄에 들어가는 만큼 이름 칩을 보이고, 남는 사람은 `+N` 으로 줄인다. `+N` 을 누르면(Enter·Space 도)
 * 전체 참석자가 팝오버로 열리고 Esc 로 닫으면 `+N` 으로 포커스가 돌아온다(Radix Popover).
 * 스크린리더에는 `참석자` 목록이 늘 전체다 — 줄에 들어가지 않은 이름은 시각적으로만 숨긴다(sr-only).
 *
 * 보일 수는 실제 폭을 재서 정한다(`fitAttendees`). 이름 길이가 제각각이라 CSS 만으로는 `+N` 의 N 을 알 수 없다.
 * 재기 전(첫 그리기)이나 잴 수 없는 환경에서도 줄 높이는 22 로 고정이고 넘치는 칩은 잘린다 — 자리는 재기에 기대지 않는다.
 * 줄 폭이 바뀌거나(창 크기) 글꼴이 늦게 와 칩 폭이 바뀌면 ResizeObserver 로 다시 잰다. 그 결과는 flushSync 로 그 자리에서
 * 반영한다 — ResizeObserver 콜백은 배치 뒤 · 그리기 전에 돈다. 보통의 setState 는 그리기 뒤 다음 작업에서 렌더해, 새 폭에
 * 이전 칩 수가 한 프레임 그려졌다(잘린 칩 · 낡은 `+N`, UX1-N02). 반영해도 줄과 재는 칸의 크기는 바뀌지 않아 되먹임이 없다.
 */
export function AttendeeRow({ attendees }: { attendees: readonly MinutesAttendee[] }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(attendees.length)

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (row === null || measure === null) return
    const fit = () => {
      const boxes = [...measure.children].map((chip) => chip.getBoundingClientRect())
      // 간격은 재는 칸의 첫 두 칩 사이(이름 칩이 하나여도 `+전체 인원` 칩이 뒤에 있다) — 계산된 스타일을 읽지 않는다
      const gap = Math.max(boxes[1].left - boxes[0].right, 0)
      const chips = boxes.map(({ width }) => width)
      const moreWidth = chips.pop() ?? 0
      return fitAttendees(chips, row.getBoundingClientRect().width, gap, moreWidth)
    }
    // 그리기 전에 한 번 — 첫 프레임부터 잰 결과다. 레이아웃 효과 안의 setState 는 이미 그리기 전에 반영된다
    setShown(fit())
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const next = fit()
      flushSync(() => setShown(next))
    })
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [attendees])

  const total = attendees.length
  const hidden = total - shown

  return (
    <div ref={rowRef} className={`relative ${ATTENDEE_ROW}`}>
      <ul
        aria-label="참석자"
        className="relative flex min-w-[0px] items-center gap-6 overflow-hidden"
      >
        {attendees.map((attendee, index) => (
          <li key={attendee.memberId} className={index < shown ? CHIP : 'sr-only'}>
            {attendee.displayName}
          </li>
        ))}
      </ul>
      {hidden > 0 ? <AllAttendees attendees={attendees} hidden={hidden} /> : null}
      <div aria-hidden="true" className={MEASURE_BOX}>
        <div ref={measureRef} data-testid="attendee-measure" className="flex w-max gap-6">
          {attendees.map((attendee) => (
            <span
              key={attendee.memberId}
              data-label={attendee.displayName}
              className={MEASURE_CHIP}
            />
          ))}
          <span data-label={`+${total}`} className={MEASURE_CHIP} />
        </div>
      </div>
    </div>
  )
}

/** `+N` — 누르면 전체 참석자. 이름은 보이는 글자(`+N`)로 시작한다(보이는 이름과 읽히는 이름이 이어진다) */
function AllAttendees({
  attendees,
  hidden,
}: {
  attendees: readonly MinutesAttendee[]
  hidden: number
}) {
  const headingId = useId()
  return (
    <Popover>
      <PopoverTrigger
        className={MORE}
        aria-label={`+${hidden}, 참석자 ${attendees.length}명 모두 보기`}
      >
        +{hidden}
      </PopoverTrigger>
      <PopoverContent aria-labelledby={headingId}>
        <p id={headingId} className="text-meta leading-none font-semibold text-dim">
          참석자 {attendees.length}명
        </p>
        <ul className="flex flex-wrap gap-6">
          {attendees.map((attendee) => (
            <li key={attendee.memberId} className={CHIP}>
              {attendee.displayName}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
