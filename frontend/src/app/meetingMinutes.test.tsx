import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { clearTrackedMeetings, meetingListQueryOptions } from '@/entities/meeting'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { fail, list, ok } from '@/shared/mock/envelope'
import { meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'
import { completeMeeting, failMeeting, startChatMeeting } from '@/shared/mock/meetingFlow'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { AWAITING_MEETING_ID, createSpeakerScenarioDb } from '@/shared/mock/speakerScenarios'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { NOTION_NOTE_FOR_MEMBER, NOTION_NOTE_FOR_PM } from '@/widgets/meeting-minutes'
import { onTestFinished } from 'vitest'
import { renderApp } from './test/renderApp'

/*
 * M5 U5 — 회의록 목록·상세. 실제 경로 표·MSW handler·request() 를 그대로 탄다.
 * 픽스처의 ws_01: 정리 끝난 mt_09(3주차, 09-15, 추출 6건 — 반영 3 · 대기 승인 3)·채팅 mt_08(09-11~09-12, 추출 1건)·
 * mt_07(2주차, 09-08, 추출 0건),
 * 정리 중 mt_10(09-18). 늦은 응답이 화면을 옮기는 경합은 meetingMinutesRaces.test.tsx 가 본다.
 */

vi.setConfig({ testTimeout: 10_000 })

afterEach(() => {
  clearTrackedMeetings()
})

const MT_09 = paths.meetings('ws_01', 'mt_09')
const MT_08 = paths.meetings('ws_01', 'mt_08')
const MT_07 = paths.meetings('ws_01', 'mt_07')

type Log = ReturnType<typeof recordRequests>
const minutesRequests = (log: Log) => log.started.filter(({ path }) => /\/minutes$/.test(path))
const extractionRequests = (log: Log) =>
  log.started.filter(({ path }) => path.startsWith('/extractions/'))
const approvalRequests = (log: Log) =>
  log.started.filter(({ path }) => path.startsWith('/approvals'))

const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

function meetingList() {
  return screen.getByRole('complementary', { name: '회의 목록' })
}
function minutesList() {
  return within(meetingList()).getByRole('list', { name: '정리된 회의' })
}
function detail() {
  return screen.getByRole('region', { name: '회의록 본문' })
}
async function openMinutes(path: string, title: string) {
  const app = renderApp(path)
  await screen.findByRole('heading', { level: 2, name: title })
  return app
}
async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('tab', { name }))
  return screen.getByRole('tabpanel')
}

describe('목록과 기본 선택 (U5-1)', () => {
  it('기본 진입은 가장 최근 정리 끝난 회의를 고르고 주소를 replace 한다 — 목록은 회의 날짜 최신순이다', async () => {
    const app = renderApp(paths.meetings('ws_01'))

    await app.expectPath(MT_09)
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.meetings('ws_01'), MT_09])
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(
      await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' }),
    ).toBeInTheDocument()

    const links = within(minutesList()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([MT_09, MT_08, MT_07])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[0]).toHaveTextContent('09/15 14:00 · 46분 · 4명')
  })

  it('서버가 순서를 틀리게 줘도 회의 날짜 최신순으로 보이고 그중 최신을 고른다', async () => {
    const done = meetingSummaryFixtures.filter(({ status }) => status === 'done')
    // 오래된 것부터 준다
    server.use(http.get('/api/v1/workspaces/:workspaceId/meetings', () => list([...done])))
    const app = renderApp(paths.meetings('ws_01'))

    await app.expectPath(MT_09)
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
    expect(
      within(minutesList())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([MT_09, MT_08, MT_07])
  })

  it('직접 링크로 고른 회의는 목록을 다시 받아도, 더 최근 회의가 정리돼도 그대로다', async () => {
    const app = await openMinutes(MT_07, '2주차 정기회의')

    // 더 최근(09-18) 회의의 정리가 끝났다. 목록을 다시 받는다
    completeMeeting('mt_10')
    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: meetingListQueryOptions('ws_01').queryKey }),
    )
    await waitFor(() =>
      expect(
        within(minutesList())
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual([
        expect.stringContaining('기획 논의 녹음'),
        expect.stringContaining('3주차 정기회의'),
        expect.stringContaining('채팅 2026-09-11'),
        expect.stringContaining('2주차 정기회의'),
      ]),
    )
    await settle()

    expect(app.visited().map(({ pathname }) => pathname)).toEqual([MT_07])
    expect(screen.getByRole('heading', { level: 2, name: '2주차 정기회의' })).toBeInTheDocument()
  })

  it('목록에서 고른 회의도 다시 받은 뒤 그대로다', async () => {
    const user = userEvent.setup()
    const app = renderApp(paths.meetings('ws_01'))
    await app.expectPath(MT_09)

    await user.click(within(minutesList()).getByRole('link', { name: /2주차 정기회의/ }))
    await app.expectPath(MT_07)
    expect(
      await screen.findByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()

    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: meetingListQueryOptions('ws_01').queryKey }),
    )
    await settle()
    expect(
      app
        .visited()
        .map(({ pathname }) => pathname)
        .at(-1),
    ).toBe(MT_07)
    expect(screen.getByRole('heading', { level: 2, name: '2주차 정기회의' })).toBeInTheDocument()
  })
})

describe('상태 항목과 빈 상태 (U5-2)', () => {
  it('만료 이력만 있어도 빈 목록으로 숨기지 않고, 선택하면 사유와 PM 재업로드 동선을 제공한다', async () => {
    const user = userEvent.setup()
    failMeeting('mt_10', { failedStage: 'speaker_assignment_expired' })
    db.meetings = db.meetings.filter(({ meeting_id }) => meeting_id === 'mt_10')
    const log = recordRequests()
    renderApp(paths.meetings('ws_01'))
    const expired = await screen.findByRole('list', { name: '화자 지정 기한 만료' })
    expect(screen.queryByText('아직 올린 회의가 없어요')).toBeNull()
    await user.click(within(expired).getByRole('link', { name: /기획 논의 녹음/ }))
    expect(
      await screen.findByRole('heading', { name: '화자 지정 기한이 지났어요' }),
    ).toBeInTheDocument()
    expect(within(detail()).getByRole('link', { name: '다시 업로드' })).toHaveAttribute(
      'href',
      paths.meetingUpload('ws_01'),
    )
    expect(minutesRequests(log)).toEqual([])
    expect(extractionRequests(log)).toEqual([])
  })

  it('멈춘 채팅 회의(chat_stalled)를 직접 열면 다시 올리라고 하지 않는다 (#450)', async () => {
    const chatId = startChatMeeting()
    failMeeting(chatId, { failedStage: 'chat_stalled' })
    renderApp(paths.meetings('ws_01', chatId))
    expect(
      await screen.findByRole('heading', { name: '채팅 대화를 정리하지 못했어요' }),
    ).toBeInTheDocument()
    expect(
      within(detail()).getByText('채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.'),
    ).toBeInTheDocument()
    expect(within(detail()).queryByRole('link', { name: '다시 업로드' })).toBeNull()
    expect(within(detail()).queryByText(/재업로드|다시 올려/)).toBeNull()
  })

  it('정리 중 회의는 진행 중 항목으로 처리 화면에 잇고, 정리된 회의에는 없다', async () => {
    await openMinutes(paths.meetings('ws_01'), '3주차 정기회의')

    const inProgress = within(meetingList()).getByRole('list', { name: '진행 중' })
    const link = within(inProgress).getByRole('link', { name: /기획 논의 녹음/ })
    expect(link).toHaveAttribute('href', paths.meetingProcessing('ws_01', 'mt_10'))
    expect(link).toHaveTextContent('정리 중')
    expect(within(minutesList()).queryByText('기획 논의 녹음')).toBeNull()
  })

  it('실패 회의는 목록 어디에도 없다', async () => {
    failMeeting('mt_10')
    await openMinutes(paths.meetings('ws_01'), '3주차 정기회의')

    expect(within(meetingList()).queryByText('기획 논의 녹음')).toBeNull()
    expect(within(meetingList()).queryByRole('list', { name: '진행 중' })).toBeNull()
  })

  it('Discord 봇이 기록 중인 회의는 상태만 보이고 갈 곳이 없다 (U5-9)', async () => {
    db.meetings.push({
      ...db.meetings[1],
      meeting_id: 'mt_20',
      title: '디스코드 회의',
      status: 'recording',
      started_at: '2026-09-20T05:00:00Z',
      ended_at: null,
      extraction_id: null,
    })
    db.meetingSummaries.push({
      ...db.meetingSummaries[1],
      meeting_id: 'mt_20',
      title: '디스코드 회의',
      status: 'recording',
      started_at: '2026-09-20T05:00:00Z',
    })
    await openMinutes(paths.meetings('ws_01'), '3주차 정기회의')

    const inProgress = within(meetingList()).getByRole('list', { name: '진행 중' })
    const row = within(inProgress).getByText('디스코드 회의').closest('li')!
    expect(row).toHaveTextContent('회의 중')
    expect(within(row).queryByRole('link')).toBeNull()
  })

  it.each([
    ['PM', 'pm', true],
    ['일반 팀원', 'member', false],
  ] as const)(
    '회의가 하나도 없으면 EmptyMeetings — %s 의 업로드 CTA %s',
    async (_label, role, hasCta) => {
      setMockRole(role)
      server.use(http.get('/api/v1/workspaces/:workspaceId/meetings', () => list([])))
      const app = renderApp(paths.meetings('ws_01'))

      expect(
        await screen.findByRole('heading', { level: 1, name: '아직 올린 회의가 없어요' }),
      ).toBeInTheDocument()
      const cta = screen.queryByRole('link', { name: '회의 올리기' })
      if (hasCta) expect(cta).toHaveAttribute('href', paths.meetingUpload('ws_01'))
      else expect(cta).toBeNull()
      // 캔버스의 `텍스트로 붙여넣기` 는 범위 밖이다
      expect(screen.queryByText('텍스트로 붙여넣기')).toBeNull()
      await settle()
      expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.meetings('ws_01')])
    },
  )

  it('정리 끝난 회의가 없고 정리 중만 있으면 목록엔 상태 항목, 본문은 빈 상태다 — 주소를 바꾸지 않는다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/meetings', () =>
        list(meetingSummaryFixtures.filter(({ status }) => status === 'processing')),
      ),
    )
    const app = renderApp(paths.meetings('ws_01'))

    expect(
      await screen.findByRole('heading', { level: 2, name: '아직 정리가 끝난 회의가 없어요' }),
    ).toBeInTheDocument()
    expect(within(meetingList()).getByRole('list', { name: '진행 중' })).toBeInTheDocument()
    await settle()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.meetings('ws_01')])
  })

  it('목록 머리의 회의 올리기는 PM 에게만 있다', async () => {
    await openMinutes(MT_09, '3주차 정기회의')
    expect(within(meetingList()).getByRole('link', { name: '회의 올리기' })).toHaveAttribute(
      'href',
      paths.meetingUpload('ws_01'),
    )
  })
})

describe('회의록 상세 (U5-3)', () => {
  it('제목·날짜·참석자·출처·요약·전사문·반영 태스크를 보인다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    const region = detail()

    expect(within(region).getByText('2026-09-15 14:00 · 45:30')).toBeInTheDocument()
    expect(within(region).getByText('Discord 자동 수집')).toBeInTheDocument()
    expect(
      within(within(region).getByRole('list', { name: '참석자' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['김서연', '박민수', '이재환', '정하늘'])

    // 요약이 기본 탭이다
    const summary = screen.getByRole('tabpanel')
    expect(within(summary).getByText('인증 연동과 배포 준비 상황을 공유했다.')).toBeInTheDocument()
    expect(within(summary).getByText('로그인 API를 연동한다.')).toBeInTheDocument()
    expect(
      within(summary).getByText('담당자와 마감이 확정된 항목부터 반영한다.'),
    ).toBeInTheDocument()

    const transcript = await openTab(user, /전사문/)
    expect(within(transcript).getByText('회원가입 화면은 제가 맡겠습니다.')).toBeInTheDocument()
    expect(within(transcript).getByText('02:05')).toBeInTheDocument()
    // 이름이 등록되지 않은 화자는 Discord 이름으로 보인다 (D-028)
    expect(within(transcript).getByText('jihun_dev')).toBeInTheDocument()

    const tasks = await openTab(user, /추출된 일/)
    expect(await within(tasks).findByRole('link', { name: '로그인 API 연동' })).toBeInTheDocument()
    expect(within(tasks).getByText('담당 김서연 · 마감 9/20')).toBeInTheDocument()
  })

  it('직접 들어온 회의의 상세가 늦으면 목록은 보이고, 본문 자리는 스켈레톤이며 회의 제목이 없다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/meetings/mt_09', async () => {
        await gate.promise
        return undefined
      }),
    )
    renderApp(MT_09)

    expect(await screen.findByTestId('minutes-detail-skeleton')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(await screen.findByRole('link', { name: /2주차 정기회의/ })).toBeInTheDocument()
    expect(within(meetingList()).getByRole('link', { name: /2주차 정기회의/ })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('요약 null · 빈 전사문 · 참석자 없음 · 추출 결과 없음은 각각 빈 상태다 — 추출 요청을 보내지 않는다', async () => {
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_07')!
    minutes.summary = null
    minutes.transcript = []
    minutes.attendees = []
    db.meetings.find(({ meeting_id }) => meeting_id === 'mt_07')!.extraction_id = null
    const log = recordRequests()
    const user = userEvent.setup()
    await openMinutes(MT_07, '2주차 정기회의')

    expect(within(detail()).getByText('참석자 정보가 없어요')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('요약이 아직 없어요')).toBeInTheDocument()
    expect(within(await openTab(user, /전사문/)).getByText('전사문이 없어요')).toBeInTheDocument()
    expect(within(detail()).queryByRole('list', { name: '전사문' })).toBeNull()
    const tasks = await openTab(user, /추출된 일/)
    expect(within(tasks).getByText('추출된 일이 없어요')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveAccessibleName('추출된 일 0')
    await settle()
    expect(extractionRequests(log)).toEqual([])
  })

  it('항목이 0건인 추출은 반영된 태스크 빈 상태다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_07, '2주차 정기회의')

    const tasks = await openTab(user, /추출된 일/)
    expect(await within(tasks).findByText('아직 반영된 태스크가 없어요')).toBeInTheDocument()
  })

  it('추출 결과를 찾지 못하면(404) 빈 상태, 다른 실패는 다시 시도할 수 있다', async () => {
    server.use(
      http.get('/api/v1/extractions/:extractionId', () =>
        fail('EXTRACTION_NOT_FOUND', '추출 결과가 없습니다.', 404),
      ),
    )
    const user = userEvent.setup()
    const first = await openMinutes(MT_09, '3주차 정기회의')
    expect(
      await within(await openTab(user, /추출된 일/)).findByText('추출된 일이 없어요'),
    ).toBeInTheDocument()
    first.unmount()

    server.use(
      http.get('/api/v1/extractions/:extractionId', () => fail('FORBIDDEN', '권한이 없어요.', 403)),
    )
    await openMinutes(MT_09, '3주차 정기회의')
    const tasks = await openTab(user, /추출된 일/)
    expect(await within(tasks).findByText('추출된 일을 불러오지 못했어요')).toBeInTheDocument()
    expect(within(tasks).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('탭은 화살표·Home·End 로 옮긴다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    const summaryTab = screen.getByRole('tab', { name: '요약' })
    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
    act(() => summaryTab.focus())
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '전사문' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: '전사문' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(summaryTab).toHaveFocus()
    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
  })
  it('Tab 은 글만 있는 요약 패널에는 패널로, 링크가 있는 추출된 일 패널에서는 패널을 건너 첫 링크로 간다 (#337)', async () => {
    const user = userEvent.setup()
    renderApp(MT_09)
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' }, { timeout: 5_000 })

    act(() => screen.getByRole('tab', { name: '요약' }).focus())
    await user.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()

    const tasks = await openTab(user, /추출된 일/)
    const first = await within(tasks).findByRole('link', { name: '로그인 API 연동' })
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
  })
})

describe('공간 확인 (U5-4)', () => {
  it('받아 둔 회의록이 있어도 다시 받은 상세가 다른 공간이면 볼 수 없는 회의로 바꾸고 본문·추출을 다시 묻지 않는다 (#349)', async () => {
    const app = renderApp(paths.meetings('ws_01', 'mt_09'))
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
    server.use(
      http.get('/api/v1/meetings/mt_09', () => {
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')!
        return ok({ ...meeting, workspace_id: 'ws_02' })
      }),
    )
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
      }),
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '3주차 정기회의' })).toBeNull()
    const log = recordRequests()
    await act(() => app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01') }))
    await settle(150)
    expect(minutesRequests(log)).toEqual([])
    expect(extractionRequests(log)).toEqual([])
  })

  it('회의 상세의 공간이 URL 과 다르면 본문·추출 요청이 0회다', async () => {
    // 다른 공간(ws_02)의 정리 끝난 회의. 상세는 봇 경로라 경로에 공간이 없어 답이 온다
    db.meetings.push({ ...db.meetings[1], meeting_id: 'mt_50', workspace_id: 'ws_02' })
    const log = recordRequests()
    renderApp(paths.meetings('ws_01', 'mt_50'))

    expect(
      await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    await settle(150)
    expect(log.started).toContainEqual({ method: 'GET', path: '/meetings/mt_50' })
    expect(minutesRequests(log)).toEqual([])
    expect(extractionRequests(log)).toEqual([])
    expect(approvalRequests(log)).toEqual([])
    expect(screen.queryByText('인증 연동과 배포 준비 상황을 공유했다.')).toBeNull()
  })

  it('없는 회의(404)·모양이 틀린 ID 는 볼 수 없는 회의로 안내하고 주소를 바꾸지 않는다', async () => {
    const log = recordRequests()
    const first = renderApp(paths.meetings('ws_01', 'mt_404'))
    expect(
      await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    expect(minutesRequests(log)).toEqual([])
    first.unmount()

    const app = renderApp('/workspaces/ws_01/meetings/bad.id')
    expect(
      await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    await settle()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([
      '/workspaces/ws_01/meetings/bad.id',
    ])
    expect(log.started.filter(({ path }) => path.includes('bad.id'))).toEqual([])
  })
})

describe('반영과 확인 필요 (U5-5, U5-7)', () => {
  it('PM 은 반영된 것과 확인이 필요한 일을 따로 본다 — 각각 태스크 상세·승인 상세로 잇는다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    const tasks = await openTab(user, /추출된 일/)

    expect(
      await within(tasks).findByRole('heading', { name: '확인이 필요한 일 3' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveAccessibleName('추출된 일 6')
    expect(within(tasks).getByRole('link', { name: '로그인 API 연동' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_01'),
    )
    expect(within(tasks).getByRole('link', { name: '알림 문구 검토 채워 넣기' })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_01'),
    )
    expect(within(tasks).getByRole('link', { name: '테스트 계획 정리 확인하기' })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_02'),
    )
    expect(within(tasks).getByText('마감을 정해야 해요')).toBeInTheDocument()
  })

  it('승인된 항목은 반영된 것에 한 번만, 반려된 항목은 어디에도 없다', async () => {
    // ap_02 승인: 백엔드처럼 task_id 를 채우고 approval_id 는 그대로 둔다 (계약 §4.0-②-12). ap_03 반려: 항목은 그대로다
    db.approvals.find(({ approval_id }) => approval_id === 'ap_02')!.status = 'approved'
    db.extractions[1].items.find(({ item_id }) => item_id === 'it_05')!.task_id = 'tk_90'
    db.approvals.find(({ approval_id }) => approval_id === 'ap_03')!.status = 'rejected'
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    const tasks = await openTab(user, /추출된 일/)

    expect(
      await within(tasks).findByRole('heading', { name: '확인이 필요한 일 1' }),
    ).toBeInTheDocument()
    expect(within(tasks).getAllByText('테스트 계획 정리')).toHaveLength(1)
    expect(within(tasks).getByRole('link', { name: '테스트 계획 정리' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_90'),
    )
    expect(within(tasks).queryByText('배포 문서 보완')).toBeNull()
    expect(within(tasks).getByText('알림 문구 검토')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveAccessibleName('추출된 일 5')
  })

  it('확인하기를 누르면 승인 상세, 반영된 태스크를 누르면 태스크 상세로 간다', async () => {
    const user = userEvent.setup()
    const app = await openMinutes(MT_09, '3주차 정기회의')
    let tasks = await openTab(user, /추출된 일/)
    await user.click(await within(tasks).findByRole('link', { name: '테스트 계획 정리 확인하기' }))
    await app.expectPath(paths.approval('ws_01', 'ap_02'))

    app.navigate(MT_09)
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
    tasks = await openTab(user, /추출된 일/)
    await user.click(await within(tasks).findByRole('link', { name: '회원가입 화면' }))
    await app.expectPath(paths.tasks('ws_01', 'tk_02'))
  })
})

describe('권한 (U5-6)', () => {
  it('일반 팀원은 승인 목록을 요청하지 않고 확인이 필요한 일의 영역·개수·이동이 DOM 에 없다', async () => {
    setMockRole('member')
    const log = recordRequests()
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    const tasks = await openTab(user, /추출된 일/)
    expect(await within(tasks).findByRole('link', { name: '로그인 API 연동' })).toBeInTheDocument()
    expect(within(tasks).queryByRole('heading', { name: /확인이 필요한 일/ })).toBeNull()
    expect(within(tasks).queryByText(/확인|보류|채워 넣기/)).toBeNull()
    expect(
      within(tasks)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.includes('/approvals/')),
    ).toEqual([])
    for (const hidden of ['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완'])
      expect(within(tasks).queryByText(hidden)).toBeNull()
    // 개수도 반영된 것뿐이다 (D-104)
    expect(screen.getByRole('tab', { name: /추출된 일/ })).toHaveAccessibleName('추출된 일 3')
    // 목록 머리의 회의 올리기도 없다
    expect(within(meetingList()).queryByRole('link', { name: '회의 올리기' })).toBeNull()

    await openTab(user, /요약/)
    await openTab(user, /전사문/)
    await settle(150)
    expect(approvalRequests(log)).toEqual([])
  })

  it('PM 이어도 서버가 회의록 권한(can_review)을 주지 않으면 승인 목록을 부르지도 그리지도 않는다', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', ({ params }) => {
        const minutes = db.minutes.find(({ meeting_id }) => meeting_id === params.meetingId)!
        return ok({ ...minutes, permissions: { can_review: false, can_undo: false } })
      }),
    )
    const log = recordRequests()
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    const tasks = await openTab(user, /추출된 일/)
    expect(await within(tasks).findByRole('link', { name: '로그인 API 연동' })).toBeInTheDocument()
    expect(within(tasks).queryByRole('heading', { name: /확인이 필요한 일/ })).toBeNull()
    await settle(150)
    expect(approvalRequests(log)).toEqual([])
  })

  it('PM 은 이 공간의 대기 승인 목록을 한 번 부른다', async () => {
    const log = recordRequests()
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    await openTab(user, /추출된 일/)
    await screen.findByRole('heading', { name: '확인이 필요한 일 3' })

    expect(approvalRequests(log)).toEqual([
      { method: 'GET', path: '/approvals?workspace_id=ws_01&status=pending' },
    ])
  })
})

describe('범위 밖 액션과 안내 (U5-7, U5-8, U5-9)', () => {
  it('원본 재생·검색·Notion에서 보기·되돌리기·편집이 없다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    await openTab(user, /추출된 일/)
    await screen.findByRole('heading', { name: '확인이 필요한 일 3' })

    for (const name of [/원본/, /검색/, /Notion에서 보기/, /되돌리기/, /편집/, /수정/])
      expect(screen.queryByRole('button', { name })).toBeNull()
    for (const name of [/원본/, /Notion에서 보기/, /되돌리기/, /편집/])
      expect(screen.queryByRole('link', { name })).toBeNull()
  })

  it.each([
    ['PM', 'pm', NOTION_NOTE_FOR_PM],
    ['일반 팀원', 'member', NOTION_NOTE_FOR_MEMBER],
  ] as const)(
    '%s 의 Notion 안내 — 확실한 것은 바로, 확인 필요는 승인 뒤 (U5-8)',
    async (_label, role, note) => {
      setMockRole(role)
      const user = userEvent.setup()
      await openMinutes(MT_09, '3주차 정기회의')
      const tasks = await openTab(user, /추출된 일/)

      expect(within(tasks).getByText(note)).toBeInTheDocument()
      expect(note).toContain('회의록과 확실한 태스크는')
      if (role === 'pm') expect(note).toContain('확인이 필요한 일은 승인한 뒤 반영해요')
    },
  )

  it('긴 전사문은 줄마다 content-visibility 로 화면 밖 그리기를 미룬다 (U5-8)', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')
    const transcript = await openTab(user, /전사문/)

    const lines = within(within(transcript).getByRole('list', { name: '전사문' })).getAllByRole(
      'listitem',
    )
    expect(lines).toHaveLength(5)
    for (const line of lines) expect(line.className).toContain('[content-visibility:auto]')
  })

  it('Discord 회의는 출처를 보이고 회의록 안에 업로드 관련 행동이 없다 (U5-9)', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    const region = detail()
    expect(within(region).getByText('Discord 자동 수집')).toBeInTheDocument()
    for (const tab of [/요약/, /전사문/, /추출된 일/]) {
      await openTab(user, tab)
      expect(within(region).queryByRole('link', { name: /올리기|업로드|다시 올/ })).toBeNull()
      expect(within(region).queryByRole('button', { name: /올리기|업로드|다시 올/ })).toBeNull()
    }
  })

  it('직접 올린 회의는 출처가 직접 올린 녹음이다', async () => {
    completeMeeting('mt_10')
    await openMinutes(paths.meetings('ws_01', 'mt_10'), '기획 논의 녹음')
    expect(within(detail()).getByText('직접 올린 녹음')).toBeInTheDocument()
  })

  it('정리 중인 회의를 직접 열면 처리 화면으로 잇는다', async () => {
    await openMinutes(paths.meetings('ws_01', 'mt_10'), '기획 논의 녹음')
    expect(within(detail()).getByRole('link', { name: '정리 상태 보기' })).toHaveAttribute(
      'href',
      paths.meetingProcessing('ws_01', 'mt_10'),
    )
    fireEvent.click(within(detail()).getByRole('link', { name: '정리 상태 보기' }))
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
  })
})

describe('채팅 회의 (#379)', () => {
  it('같은 목록에 시간순으로 섞이고 채팅 배지와 시작 시각·인원만 보인다', async () => {
    await openMinutes(MT_09, '3주차 정기회의')

    const links = within(minutesList()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([MT_09, MT_08, MT_07])
    expect(within(links[1]).getByText('채팅')).toBeInTheDocument()
    expect(links[1]).toHaveTextContent('09/11 09:12 · 3명')
    expect(within(links[0]).queryByText('채팅')).toBeNull()
    expect(links[0]).toHaveTextContent('09/15 14:00 · 46분 · 4명')
  })

  it('회의록 머리는 첫 메시지부터 마지막 메시지까지의 서울 시각 범위이고, 전사문·근거는 쓴 시각이다', async () => {
    const user = userEvent.setup()
    await openMinutes(MT_08, '채팅 2026-09-11')
    const region = detail()

    expect(within(region).getByText('2026-09-11 09:12 ~ 09/12 08:40')).toBeInTheDocument()
    expect(within(region).getByText('Discord 채팅')).toBeInTheDocument()

    const transcript = await openTab(user, /전사문/)
    expect(
      within(within(transcript).getByRole('list', { name: '전사문' }))
        .getAllByRole('listitem')
        .map((line) => line.firstElementChild?.textContent),
    ).toEqual(['09/11 09:12', '09/11 11:15', '09/11 18:40', '09/12 08:40'])

    const tasks = await openTab(user, /추출된 일/)
    const applied = (await within(tasks).findByRole('link', { name: '배포 스크립트' })).closest(
      'li',
    )!
    expect(applied).toHaveTextContent('09/11 18:40')
  })

  it('정리 중인 채팅 회의도 처리 화면으로 잇는다 — 채팅 두 단계 처리 화면이 생겼다 (#483)', async () => {
    db.meetings.push({
      ...db.meetings[3],
      meeting_id: 'mt_21',
      title: '채팅 2026-09-19',
      status: 'processing',
      started_at: '2026-09-19T00:05:00Z',
      ended_at: '2026-09-19T08:00:00Z',
      extraction_id: null,
    })
    db.meetingSummaries.push({
      ...db.meetingSummaries[3],
      meeting_id: 'mt_21',
      title: '채팅 2026-09-19',
      status: 'processing',
      started_at: '2026-09-19T00:05:00Z',
      processed_at: null,
    })
    await openMinutes(paths.meetings('ws_01'), '3주차 정기회의')

    const inProgress = within(meetingList()).getByRole('list', { name: '진행 중' })
    const row = within(inProgress).getByText('채팅 2026-09-19').closest('li')!
    expect(row).toHaveTextContent('채팅')
    expect(row).toHaveTextContent('정리 중')
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      paths.meetingProcessing('ws_01', 'mt_21'),
    )
    // 녹음 회의의 정리 중 항목도 그대로 처리 화면으로 잇는다
    expect(within(inProgress).getByRole('link', { name: /기획 논의 녹음/ })).toHaveAttribute(
      'href',
      paths.meetingProcessing('ws_01', 'mt_10'),
    )
  })
})

describe('화자 지정 대기 (#256)', () => {
  const MT_11 = paths.meetings('ws_01', AWAITING_MEETING_ID)
  const SPEAKERS = paths.meetingSpeakers('ws_01', AWAITING_MEETING_ID)

  it.each([
    ['PM', 'meeting-speakers', '누가 말했는지 골라 주세요'],
    ['일반 팀원', 'meeting-speakers-member', 'PM이 화자를 지정하고 있어요'],
  ] as const)(
    '%s 의 목록 진행 중 항목은 화자 지정 필요로 보이고 지정 화면으로 간다',
    async (_label, scenario, heading) => {
      const user = userEvent.setup()
      replaceDb(createSpeakerScenarioDb(scenario))
      renderApp(paths.meetings('ws_01'))

      const inProgress = await within(
        await screen.findByRole('complementary', { name: '회의 목록' }),
      ).findByRole('list', { name: '진행 중' })
      const link = within(inProgress).getByRole('link', { name: /주간 회고 녹음/ })
      expect(link).toHaveAttribute('href', SPEAKERS)
      expect(link).toHaveTextContent('화자 지정 필요')
      expect(within(minutesList()).queryByText('주간 회고 녹음')).toBeNull()

      await user.click(link)
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    },
  )

  it('PM 이 대기 중인 회의를 직접 열면 회의록을 부르지 않고 지정 화면으로 잇는다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    const log = recordRequests()
    renderApp(MT_11)

    expect(
      await screen.findByRole('heading', { level: 2, name: '화자 지정이 필요해요' }),
    ).toBeInTheDocument()
    expect(within(detail()).getByText('주간 회고 녹음')).toBeInTheDocument()
    expect(within(detail()).getByRole('link', { name: '화자 지정하기' })).toHaveAttribute(
      'href',
      SPEAKERS,
    )
    await settle()
    expect(minutesRequests(log)).toEqual([])
    expect(extractionRequests(log)).toEqual([])
  })

  it('일반 팀원은 같은 안내를 보지만 지정 링크 대신 PM 이 지정 중이라고 듣는다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers-member'))
    const log = recordRequests()
    renderApp(MT_11)

    expect(
      await screen.findByRole('heading', { level: 2, name: '화자 지정이 필요해요' }),
    ).toBeInTheDocument()
    expect(within(detail()).getByText(/PM이 화자를 지정하고 있어요/)).toBeInTheDocument()
    expect(within(detail()).queryByRole('link')).toBeNull()
    await settle()
    expect(minutesRequests(log)).toEqual([])
  })
})

describe('받아 둔 회의록 뒤 403·404 (#405)', () => {
  const refusal = (status: 403 | 404) =>
    status === 404
      ? fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
      : fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403)

  it.each([403, 404] as const)(
    '다시 받은 상세가 %i 면 받아 둔 회의록 대신 볼 수 없는 회의를 보이고 본문·추출을 다시 묻지 않는다',
    async (status) => {
      const app = renderApp(MT_09)
      await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
      server.use(http.get('/api/v1/meetings/mt_09', () => refusal(status)))
      await act(() =>
        app.queryClient.invalidateQueries({
          queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
        }),
      )
      expect(
        await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 2, name: '3주차 정기회의' })).toBeNull()
      const log = recordRequests()
      await act(() => app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01') }))
      await settle(150)
      expect(minutesRequests(log)).toEqual([])
      expect(extractionRequests(log)).toEqual([])
    },
  )

  it.each([403, 404] as const)(
    '다시 받은 회의록 본문이 %i 면 받아 둔 본문 대신 볼 수 없는 회의를 보인다',
    async (status) => {
      const app = renderApp(MT_09)
      await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
      server.use(http.get('/api/v1/meetings/mt_09/minutes', () => refusal(status)))
      await act(() =>
        app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'minutes', 'mt_09') }),
      )
      expect(
        await screen.findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 2, name: '3주차 정기회의' })).toBeNull()
    },
  )
})
