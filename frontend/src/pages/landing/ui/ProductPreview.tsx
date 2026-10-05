import { BrandMark } from '@/shared/ui/brand-mark'
import { Icon } from '@/shared/ui/icon'
import { CARD_WIDTH } from './styles'

/*
 * 제품 미리보기. 회의록 화면을 흉내 낸 **정적 그림**이다 — 데이터 요청도, 누를 곳도 없다.
 * 캔버스의 버튼·링크는 전부 span 으로 옮겼다. 전체가 한 장의 그림(role="img")이라 스크린리더는 이름 하나만 읽는다.
 * 값은 Landing 캔버스의 미리보기 블록 실측이다.
 */

const TABS = [
  { label: '대시보드' },
  { label: '회의록', active: true },
  { label: '태스크', count: 3 },
  { label: '메시지', count: 2 },
  { label: '팀' },
] as const

const MEETINGS = [
  { title: '3주차 정기회의', meta: '09/09 14:00 · 52분 · 4명', pending: 3 },
  { title: '디자인 싱크', meta: '09/04 16:30 · 28분 · 3명' },
  { title: '2주차 정기회의', meta: '09/02 14:00 · 61분 · 5명' },
  { title: '기획 리뷰', meta: '08/28 11:00 · 44분 · 4명' },
  { title: '1주차 킥오프', meta: '08/26 14:00 · 71분 · 5명' },
] as const

const ATTENDEES = ['재', '서', '지', '도'] as const

const REVIEWS = [
  {
    badge: '확인 필요',
    title: '발표 준비',
    at: '31:05',
    reason: '담당자 후보가 둘 — 서연 / 지민',
    action: '확인하기',
  },
  {
    badge: '확인 필요',
    title: '디자인 시안 2차',
    at: '38:22',
    reason: '마감이 "다음 주쯤"으로만 언급됨',
    action: '확인하기',
  },
  {
    badge: '보류',
    title: '자료조사',
    at: '44:10',
    reason: '누가, 무엇을, 언제까지인지 모두 언급되지 않음',
    action: '채워 넣기',
  },
] as const

const SECTION = `${CARD_WIDTH} pt-56 pb-[132px]`

const FRAME = 'overflow-hidden rounded-[24px] border border-line bg-surface'

const TITLE_BAR =
  'flex h-44 items-center gap-10 border-b border-line bg-surface-sunken px-16 text-caption text-dim'

const DOT = 'h-11 w-11 rounded-999'

const WINDOW = 'flex h-[580px] flex-col overflow-hidden bg-surface'

const APP_HEADER =
  'flex h-header shrink-0 items-center justify-between gap-24 border-b border-divider px-40'

const TAB = 'inline-flex h-36 items-center gap-7 rounded-9 px-12 text-control font-semibold'

const COUNT =
  'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-999 bg-line px-5 text-[10.5px] font-semibold text-ink tabular-nums'

const SELECT =
  'inline-flex h-36 items-center gap-8 rounded-9 border border-line bg-surface px-11 text-control font-semibold text-ink'

const AVATAR =
  'inline-flex h-[29px] w-[29px] items-center justify-center rounded-999 bg-divider text-[11px] font-semibold text-ink'

const ASIDE = 'flex w-aside shrink-0 flex-col border-r border-divider'

const MEETING_ROW = 'flex flex-col items-start gap-6 rounded-10 px-14 py-13'

const MAIN = 'flex min-w-[0px] flex-1 flex-col'

const MEETING_TITLE = 'text-[26px] leading-[1.3] font-bold tracking-h1 text-ink'

const SMALL_AVATAR =
  'inline-flex h-22 w-22 items-center justify-center rounded-999 border border-surface bg-divider text-[10px] text-ink'

const TOOL =
  'inline-flex h-36 items-center gap-7 rounded-9 bg-control px-13 text-caption font-semibold text-ink'

const SECTION_TAB = 'inline-flex h-[38px] items-center gap-7 px-3 text-body font-semibold'

const REVIEW_ROW = 'flex items-start gap-16 py-18'

const BADGE_ACTIVE =
  'inline-flex h-[21px] items-center gap-5 rounded-6 bg-ink px-8 text-meta font-semibold text-surface'

const BADGE_HOLD =
  'inline-flex h-[21px] items-center rounded-6 bg-control px-8 text-meta font-semibold text-sub'

function Chevron({ className }: { className?: string }) {
  return <Icon name="chevron-right" size={13} className={className} />
}

function AppHeader() {
  return (
    <div className={APP_HEADER}>
      <div className="flex items-center gap-30">
        <BrandMark />
        <div className="flex items-center gap-2">
          {TABS.map((tab) => (
            <span
              key={tab.label}
              className={`${TAB} ${'active' in tab ? 'bg-surface-selected text-ink' : 'text-sub'}`}
            >
              {tab.label}
              {'count' in tab ? <span className={COUNT}>{tab.count}</span> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-24">
        <span className={SELECT}>
          캡스톤 5조
          <Icon name="chevron-down" size={14} className="text-dim" />
        </span>
        <span className={AVATAR}>지훈</span>
      </div>
    </div>
  )
}

function MeetingList() {
  return (
    <div className={ASIDE}>
      <div className="flex items-center justify-between gap-12 px-20 pt-18 pb-14">
        <span className="text-[17px] font-bold tracking-h2 text-ink">회의록</span>
        <span className="inline-flex h-28 w-28 items-center justify-center text-dim">
          <Icon name="search" size={16} />
        </span>
      </div>
      <div className="flex flex-col gap-4 px-12">
        {MEETINGS.map((meeting) => (
          <div
            key={meeting.title}
            className={`${MEETING_ROW} ${'pending' in meeting ? 'bg-surface-selected' : ''}`}
          >
            {'pending' in meeting ? (
              <span className="flex w-full items-center gap-8">
                <span className="flex-1 text-body font-semibold text-ink">{meeting.title}</span>
                <span className="inline-flex h-18 min-w-18 items-center justify-center rounded-999 bg-ink px-6 text-[10.5px] font-semibold text-surface">
                  {meeting.pending}
                </span>
              </span>
            ) : (
              <span className="text-body text-sub">{meeting.title}</span>
            )}
            <span className="text-meta text-dim tabular-nums">{meeting.meta}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MeetingDetail() {
  return (
    <div className={MAIN}>
      <div className="flex items-start justify-between gap-24 px-32 pt-22 pb-16">
        <div className="flex flex-col gap-7">
          <span className={MEETING_TITLE}>3주차 정기회의</span>
          <div className="flex items-center gap-12">
            <span className="text-caption text-dim tabular-nums">2026-09-09 14:00 · 52:14</span>
            <span className="h-12 w-1 bg-line" />
            <span className="flex items-center">
              {ATTENDEES.map((initial, index) => (
                <span key={initial} className={`${SMALL_AVATAR} ${index > 0 ? '-ml-6' : ''}`}>
                  {initial}
                </span>
              ))}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <span className={TOOL}>
            <Icon name="play" size={15} />
            원본 듣기
          </span>
          <span className={TOOL}>
            <Icon name="external" size={15} className="text-sub" />
            Notion에서 보기
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 border-b border-line px-32">
        <span className={`${SECTION_TAB} mr-18 border-b-2 border-ink text-ink`}>요약</span>
        <span className={`${SECTION_TAB} mr-18 text-sub`}>전사문</span>
        <span className={`${SECTION_TAB} text-sub`}>
          추출된 일
          <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-6 bg-control px-5 text-[10.5px] font-semibold text-sub tabular-nums">
            6
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-24 px-32 pt-24 pb-28">
        <div className="flex flex-col gap-14">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-ink">
              확인이 필요한 일 <span className="font-normal text-dim tabular-nums">3</span>
            </span>
            <span className="inline-flex items-center gap-3 text-caption text-sub">
              태스크에서 전부 보기
              <Chevron />
            </span>
          </div>
          <div>
            {REVIEWS.map((review, index) => {
              const hold = review.badge === '보류'
              return (
                <div
                  key={review.title}
                  className={`${REVIEW_ROW} ${index < REVIEWS.length - 1 ? 'border-b border-line' : ''}`}
                >
                  <div className="flex min-w-[0px] flex-1 flex-col gap-9">
                    <div className="flex items-center gap-10">
                      {hold ? (
                        <span className={BADGE_HOLD}>{review.badge}</span>
                      ) : (
                        <span className={BADGE_ACTIVE}>
                          <span className="mr-3 h-5 w-5 shrink-0 rounded-999 bg-surface" />
                          {review.badge}
                        </span>
                      )}
                      <span
                        className={`text-[15px] font-semibold ${hold ? 'text-sub' : 'text-ink'}`}
                      >
                        {review.title}
                      </span>
                      <span className="text-meta text-dim tabular-nums">{review.at}</span>
                    </div>
                    <span className={`text-[13px] ${hold ? 'text-dim' : 'text-sub'}`}>
                      {review.reason}
                    </span>
                  </div>
                  <span className="inline-flex h-32 items-center gap-3 px-4 text-caption font-semibold text-ink">
                    {review.action}
                    <Chevron />
                  </span>
                </div>
              )
            })}
          </div>
          <span className="text-caption text-dim">
            확실한 건은 이미 Notion에 올렸습니다. 이 세 건만 확인하면 이 회의는 끝나요. 발언 원문은
            위 <strong className="font-semibold text-sub">전사문</strong> 탭에 그대로 있습니다.
          </span>
        </div>
      </div>
    </div>
  )
}

export function ProductPreview() {
  return (
    <section id="product" className={SECTION}>
      <div
        role="img"
        aria-label="Manager's Manager 회의록 화면 미리보기. 확인이 필요한 일 3건이 모여 있어요."
        className={FRAME}
      >
        <div className={TITLE_BAR}>
          <span className="flex gap-7">
            <span className={`${DOT} bg-line-strong`} />
            <span className={`${DOT} bg-line`} />
            <span className={`${DOT} bg-divider`} />
          </span>
          <span className="flex-1 text-center">Manager&apos;s Manager — 캡스톤 5조</span>
          <span className="w-[60px] shrink-0" />
        </div>
        <div className={WINDOW}>
          <AppHeader />
          <div className="flex min-h-[0px] flex-1 items-stretch overflow-hidden">
            <MeetingList />
            <MeetingDetail />
          </div>
        </div>
      </div>
    </section>
  )
}
