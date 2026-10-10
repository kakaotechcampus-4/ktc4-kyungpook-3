import { useLayoutEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/*
 * Meetings 캔버스 실측 — 제목 26px · 1.3. 늘 한 줄(1lh)이고 넘치면 말줄임(…)으로 자른다 (UX1-M04, 사용자 결정).
 * 뼈대(shared/ui/page-skeleton 의 MinutesSkeleton)의 제목 줄도 같은 한 줄 높이라 제목이 길어도 탭 줄이 제자리다
 */
const TITLE = 'h-lh truncate text-[26px] leading-[1.3] font-bold tracking-h1 text-ink'

/**
 * 회의록 머리의 제목(h2). 보이는 줄은 한 줄이고 넘치면 말줄임이다. 제목 글자는 늘 전체라 heading 의 이름(스크린리더)은 전체 제목이다.
 * 잘렸을 때만 — 가리키면 전체 제목이 툴팁으로 뜨고, 제목이 Tab 으로 갈 수 있는 자리가 되어 키보드 포커스로도 뜬다(Esc 로 닫힌다).
 * 잘리지 않으면 툴팁도 Tab 자리도 없다. 잘렸는지는 그린 뒤 재고, 폭이 바뀌면 ResizeObserver 로 다시 잰다.
 * 툴팁은 제목 글자를 그대로 다시 보이는 것이라 aria-describedby 로 잇지 않는다 — 이으면 같은 제목을 두 번 읽는다.
 */
export function MinutesTitle({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const heading = ref.current
    if (heading === null) return
    const measure = () => setTruncated(heading.scrollWidth > heading.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    return () => observer.disconnect()
  }, [title])

  return (
    <Tooltip open={truncated && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <h2
          ref={ref}
          className={TITLE}
          // 잘렸을 때만 Tab 자리다 — 툴팁을 키보드로 여는 트리거는 포커스를 받아야 한다(WAI-ARIA tooltip 패턴, WCAG 1.4.13).
          // 제목은 누를 것이 아니라 heading 의미 그대로 둔다
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={truncated ? 0 : undefined}
          aria-describedby={undefined}
        >
          {title}
        </h2>
      </TooltipTrigger>
      <TooltipContent aria-hidden="true" data-testid="minutes-title-tooltip">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
