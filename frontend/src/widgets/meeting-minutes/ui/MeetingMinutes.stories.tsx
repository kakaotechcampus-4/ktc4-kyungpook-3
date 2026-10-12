import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { useLocation } from 'react-router'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { setMockRole } from '@/shared/mock/sessions'
import { MeetingMinutes } from './MeetingMinutes'

/*
 * 회의록 (M5 U5). ws_01 하나에 로그인한 상태 — 완료 회의 mt_07·mt_09 와 정리 중 mt_10 이 있다.
 * 역할은 widget 의 `isPm` 과 서버의 회의록 `permissions`(목록 role 로 정해진다) 둘 다 본다 — 팀원 스토리는 둘 다 팀원으로 맞춘다.
 * 기본 선택(가장 최근 회의록으로 URL 바꾸기)은 페이지가 하므로 여기서는 회의를 직접 준다.
 */

/** ws_01 의 회의를 모두 지운다 — 빈 목록 */
function noMeetings() {
  const ids = new Set(
    db.meetings
      .filter(({ workspace_id }) => workspace_id === 'ws_01')
      .map(({ meeting_id }) => meeting_id),
  )
  db.meetings = db.meetings.filter(({ meeting_id }) => !ids.has(meeting_id))
  db.meetingSummaries = db.meetingSummaries.filter(({ meeting_id }) => !ids.has(meeting_id))
}

/** mt_09 의 본문을 비운다 — 요약 없음 · 빈 전사문 · 참석자 없음 · 추출 결과 없음 */
function emptyBody() {
  const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')
  if (minutes) {
    minutes.summary = null
    minutes.transcript = []
    minutes.attendees = []
  }
  const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')
  if (meeting) meeting.extraction_id = null
}

/** 정상 길이의 표시명 스무 명 — 한 줄에 다 들어가지 않는다 (UX1-M03) */
const MANY_ATTENDEES = [
  '김서연(기획)',
  '박민수(개발)',
  '이재환(설계)',
  '정하늘(검증)',
  '최지훈(개발)',
  '윤지수(기획)',
  '강민정(설계)',
  '신동현(개발)',
  '한유진(검증)',
  '오수빈(기획)',
  '임태윤(개발)',
  '서지아(디자인)',
  '황보민재(운영)',
  '조은비(검증)',
  '남궁현우(개발)',
  '배서현(기획)',
  '유하준(설계)',
  '문채원(디자인)',
  '송지호(개발)',
  '권나연(운영)',
]

/** mt_09 의 참석자를 스무 명으로 — 회의록 본문과 목록 요약의 참석자 수를 함께 */
function manyAttendees() {
  const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')
  if (minutes)
    minutes.attendees = MANY_ATTENDEES.map((display_name, index) => ({
      member_id: `mb_many_${index}`,
      display_name,
    }))
  const summary = db.meetingSummaries.find(({ meeting_id }) => meeting_id === 'mt_09')
  if (summary) summary.attendee_count = MANY_ATTENDEES.length
}

/**
 * 한 줄에 다 들지 않는 정상 입력의 제목 (UX1-M04). Storybook 은 1280px 라 본문 칸이 900px 이다 — 1024px 에서 잘리는
 * E2E 의 제목(3회차 검증 제목)은 여기서는 딱 들어가서, 안건을 덧붙여 이 폭에서도 넘치게 했다
 */
const LONG_TITLE =
  '2026년 10월 서비스 출시 계획과 개발 일정 및 사용자 피드백을 함께 논의하는 정기 회의 — 디자인 검토 안건 포함'

/** mt_09 의 제목을 길게 — 회의 · 목록 요약 · 회의록 모두 */
function longTitle() {
  for (const list of [db.meetings, db.meetingSummaries, db.minutes])
    for (const item of list) if (item.meeting_id === 'mt_09') item.title = LONG_TITLE
}

const asMember = () => setMockRole('member')

const meta = {
  title: 'M5 회의/회의록',
  component: MeetingMinutes,
  args: { workspaceId: 'ws_01', meetingId: 'mt_09', isPm: true },
  parameters: { scenario: 'single-workspace', route: '/workspaces/ws_01/meetings/mt_09' },
} satisfies Meta<typeof MeetingMinutes>

export default meta
type Story = StoryObj<typeof meta>

/** PM — 목록 머리에 `회의 올리기`, 진행 중 항목은 처리 화면으로 */
export const PM_완료: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '3주차 정기회의' })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: /회의 올리기/ })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: /기획 논의 녹음/ })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/meetings/mt_10/processing',
    )
  },
}

/** PM 의 추출된 일 — 반영된 태스크와 확인이 필요한 일 */
export const PM_추출된_일: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: /추출된 일/ }))
    // 영역 제목(개수 포함)만 고른다 — PM 의 Notion 안내 문장에도 `확인이 필요한 일` 이 들어 있다 (U6 r2)
    await expect(
      await canvas.findByRole('heading', { name: /^확인이 필요한 일 \d+$/ }),
    ).toBeInTheDocument()
  },
}

/** 팀원 — 업로드 진입·확인이 필요한 일이 없다 (D-104, U5-6) */
export const 팀원_완료: Story = {
  args: { isPm: false },
  parameters: { setup: asMember },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '3주차 정기회의' })).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: /회의 올리기/ })).toBeNull()
    await userEvent.click(canvas.getByRole('tab', { name: /추출된 일/ }))
    await expect(canvas.queryByText(/확인이 필요한 일/)).toBeNull()
  },
}

/** 요약·전사문·참석자·추출 결과가 모두 없다 — 각자 빈 상태 */
export const 빈_본문: Story = {
  parameters: { setup: emptyBody },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('요약이 아직 없어요')).toBeInTheDocument()
    await expect(canvas.getByText('참석자 정보가 없어요')).toBeInTheDocument()
  },
}

/** 회의가 하나도 없다 — EmptyMeetings. PM 에게만 `회의 올리기` */
export const 빈_목록_PM: Story = {
  args: { meetingId: null },
  parameters: { setup: noMeetings, route: '/workspaces/ws_01/meetings' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('아직 올린 회의가 없어요')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: '회의 올리기' })).toBeInTheDocument()
  },
}

export const 빈_목록_팀원: Story = {
  args: { meetingId: null, isPm: false },
  parameters: {
    setup: () => {
      noMeetings()
      asMember()
    },
    route: '/workspaces/ws_01/meetings',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('아직 올린 회의가 없어요')).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: '회의 올리기' })).toBeNull()
  },
}

/** 고른 회의의 회의록이 늦다 — 목록은 그대로, 본문 자리에 실제 본문과 같은 배치의 스켈레톤 (UX1) */
export const 본문_로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/meetings/mt_09', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('minutes-detail-skeleton')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(await canvas.findByRole('link', { name: /2주차 정기회의/ })).toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull()
  },
}

/** 페이지처럼 주소에서 회의를 읽는다 — 목록에서 고르면 주소가 바뀌고 본문이 따라간다 */
function MinutesAtUrl(props: Parameters<typeof MeetingMinutes>[0]) {
  const meetingId = useLocation().pathname.split('/meetings/')[1] ?? null
  return <MeetingMinutes {...props} meetingId={meetingId} />
}

/**
 * UX1-M02 — 다른 회의를 골랐는데 그 회의의 답이 오지 않는다. 고른 순간부터 본문 머리는 고른 회의(목록 요약 — 참석자는 수)이고,
 * 이전 본문은 잠깐 흐리게 묶였다가 들고 있는 시간이 지나면 본문 모양 스켈레톤이 된다. 이전 회의 제목은 남지 않는다
 */
export const 고른_회의_기다림: Story = {
  render: (args) => <MinutesAtUrl {...args} />,
  parameters: {
    msw: [
      http.get('/api/v1/meetings/mt_07', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { level: 2, name: '3주차 정기회의' }),
    ).toBeInTheDocument()
    await canvas.findByRole('list', { name: '참석자' })
    await userEvent.click(canvas.getByRole('link', { name: /2주차 정기회의/ }))
    await expect(canvas.getByRole('link', { name: /2주차 정기회의/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // 고른 순간 — 머리는 고른 회의다
    await expect(canvas.getByRole('heading', { level: 2, name: '2주차 정기회의' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: '3주차 정기회의' })).toBeNull()
    // 들고 있는 시간이 지나면 본문 모양 스켈레톤 — 머리는 그대로 고른 회의다
    const skeleton = await canvas.findByTestId('minutes-detail-skeleton')
    await expect(
      within(skeleton).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeVisible()
    await expect(within(skeleton).getByText('참석자 4명')).toBeVisible()
    await expect(canvas.queryByTestId('minutes-body')).toBeNull()
  },
}

/**
 * UX1-M03 — 참석자가 많아도 참석자 줄은 칩 한 줄(22px)이다. 들어가는 만큼 이름 칩을 보이고 남는 사람은 `+N` 이다.
 * 스크린리더의 `참석자` 목록은 스무 명 전부다
 */
export const 참석자_많음: Story = {
  parameters: { setup: manyAttendees },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole('list', { name: '참석자' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(20)
    const more = await canvas.findByRole('button', { name: /^\+\d+, 참석자 20명 모두 보기$/ })
    await expect(more).toBeVisible()
    // 줄 높이는 칩 한 줄 그대로다
    await expect(list.parentElement!.getBoundingClientRect().height).toBe(22)
    const shown = within(list)
      .getAllByRole('listitem')
      .filter((item) => !item.classList.contains('sr-only'))
    await expect(more).toHaveTextContent(`+${20 - shown.length}`)
  },
}

/** `+N` 을 키보드로 연다 — 전체 참석자가 팝오버로 보이고, Esc 로 닫으면 `+N` 으로 돌아온다. 열어 둔 모습으로 끝난다 */
export const 참석자_많음_펼침: Story = {
  parameters: { setup: manyAttendees },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(document.body)
    const more = await canvas.findByRole('button', { name: /^\+\d+, 참석자 20명 모두 보기$/ })
    more.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await page.findByRole('dialog', { name: '참석자 20명' })
    await expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(MANY_ATTENDEES)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await expect(more).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(await page.findByRole('dialog', { name: '참석자 20명' })).toBeVisible()
  },
}

/**
 * UX1-M04 — 제목이 길어도 한 줄(26px · 1.3)이고 넘치면 말줄임이다. heading 이름은 전체 제목이고, 잘렸으므로 Tab 으로 갈 수 있다.
 * 키보드로 가면 전체 제목이 툴팁으로 뜨고 Esc 로 닫힌다. 열어 둔 모습으로 끝난다
 */
export const 긴_제목: Story = {
  parameters: { setup: longTitle },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(document.body)
    const heading = await canvas.findByRole('heading', { level: 2, name: LONG_TITLE })
    await expect(heading.getBoundingClientRect().height).toBeCloseTo(26 * 1.3, 1)
    await waitFor(() => expect(heading).toHaveAttribute('tabindex', '0'))
    await expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth)

    heading.focus()
    await expect(await page.findByTestId('minutes-title-tooltip')).toHaveTextContent(LONG_TITLE)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByTestId('minutes-title-tooltip')).toBeNull())
    await expect(heading).toHaveFocus()
    heading.blur()
    heading.focus()
    await expect(await page.findByTestId('minutes-title-tooltip')).toBeVisible()
  },
}
