import type { ReactNode } from 'react'
import { Icon } from '@/shared/ui/icon'
import { Mascot } from '@/shared/ui/mascot'
import { StepNav } from './StepNav'
import type { StepNavProps } from './StepNav'

export const ONBOARDING_STEP_COUNT = 4

export interface OnboardingLayoutProps {
  /** 1~4. 단계 점과 `n / 4` 가 이 값으로 그려진다 */
  stepNumber: number
  /** 화면 이름 — `워크스페이스 만들기` · `Discord 연결` … 캔버스 카드 제목(`팀 만들기`)과 달라서 숨은 제목이다 */
  title: string
  /** 왼쪽 위 나가기 화살표 (D-069). 일반 팀원 대기 화면에도 둔다 */
  exit?: ReactNode
  /** 매스 말풍선 위 한 줄 — `디스코드 연동 완료` */
  notice?: string
  /** 매스 말풍선. 위에서부터 */
  messages: readonly string[]
  /** 단계 카드 */
  children: ReactNode
  /** `n / 4` 양옆의 `이전 단계` · `다음 단계` 화살표. 없으면 카운터만 둔다 — 일반 팀원 대기 화면 */
  nav?: StepNavProps
}

/* SetupTeam·SetupDiscord·SetupNotion·SetupMembers 실측. 512px 열 · 34px 간격 · 말풍선 38px 매스 */
const SCREEN = 'relative flex min-h-dvh items-center justify-center bg-surface px-48 py-64 text-ink'

const COLUMN = 'flex w-[512px] max-w-full flex-col gap-34'

const EXIT_SLOT = 'absolute top-24 left-24'

const DOTS = 'flex items-center justify-center gap-7'

const DOT_CURRENT = 'h-6 w-6 rounded-999 bg-ink'

const DOT = 'h-5 w-5 rounded-999 bg-inactive'

const BUBBLES = 'flex flex-col gap-20'

const BUBBLE_ROW = 'flex items-start gap-12'

const BUBBLE =
  'min-w-[0px] flex-1 rounded-10 bg-surface-selected px-18 py-13 text-body leading-[1.7] text-ink'

const NOTICE = 'flex items-center gap-9 pl-[42px] text-caption text-dim'

const COUNTER = 'text-[13px] text-faint tabular-nums'

/**
 * 온보딩 네 화면의 공통 틀 — 단계 표시 · 매스 말풍선 · 단계 카드 · `‹ n / 4 ›`.
 * 진행·건너뛰기 버튼은 카드 안에 그대로 있다. 오른쪽 화살표는 지금 단계에서는 건너뛰기와 같고,
 * 왼쪽 화살표는 지난 단계를 둘러보기(`?review=1`)로 연다 — 둘러보기의 오른쪽 화살표는 요청 없이 한 칸 앞으로 간다.
 * 캔버스 하단의 `이전`/`다음` 글자 버튼 대신 카운터 양옆 화살표다
 * (docs/impl-decision/2026-09-28-onboarding-layout.md, 2026-09-29).
 */
export function OnboardingLayout({
  stepNumber,
  title,
  exit,
  notice,
  messages,
  children,
  nav,
}: OnboardingLayoutProps) {
  const counter = (
    <span className={COUNTER} aria-hidden="true">
      {stepNumber} / {ONBOARDING_STEP_COUNT}
    </span>
  )
  return (
    <main className={SCREEN}>
      {exit === undefined ? null : <div className={EXIT_SLOT}>{exit}</div>}
      <div className={COLUMN}>
        <h1 className="sr-only">{title}</h1>
        <div
          className={DOTS}
          role="img"
          aria-label={`${ONBOARDING_STEP_COUNT}단계 중 ${stepNumber}단계`}
        >
          {Array.from({ length: ONBOARDING_STEP_COUNT }, (_dot, index) => (
            <span key={index} className={index + 1 === stepNumber ? DOT_CURRENT : DOT} />
          ))}
        </div>

        <div className={BUBBLES}>
          {notice === undefined ? null : (
            <p className={NOTICE}>
              <Icon name="check" size={14} strokeWidth={2.4} className="text-ink" />
              {notice}
            </p>
          )}
          {messages.map((message) => (
            <div key={message} className={BUBBLE_ROW}>
              <Mascot size={38} className="shrink-0" />
              <p className={BUBBLE}>{message}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-28">
          {children}
          <div className="flex items-center pt-4">
            {nav === undefined ? counter : <StepNav {...nav}>{counter}</StepNav>}
          </div>
        </div>
      </div>
    </main>
  )
}
