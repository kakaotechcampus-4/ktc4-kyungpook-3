import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { captureSavedFiles } from '@/shared/test/savedFiles'
import { renderApp } from './test/renderApp'

/*
 * #551 — 회의록의 요약 상태(summary_status)와 요약본 내려받기. 픽스처 mt_09 는 요약이 있고 mt_07 은 요약을 지워 쓴다.
 * 승인 대기는 대기 카드가 있는 mt_09 의 요약을 지워 쓴다.
 */

vi.setConfig({ testTimeout: 10_000 })

afterEach(() => {
  clearTrackedMeetings()
})

const MT_09 = paths.meetings('ws_01', 'mt_09')
const MT_07 = paths.meetings('ws_01', 'mt_07')

async function openMinutes(path: string, title: string) {
  renderApp(path)
  await screen.findByRole('heading', { level: 2, name: title })
  return screen.getByRole('tabpanel')
}

function withoutSummary(status: string) {
  const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_07')!
  minutes.summary = null
  minutes.summary_status = status
}

const downloadButton = () => screen.queryByRole('button', { name: '요약본 내려받기' })

const AWAITING_TITLE = '승인이 끝나면 요약이 만들어져요'

/** mt_09 의 대기 카드는 ap_01~ap_03 이다. 남은 건수는 minutes handler 가 이 카드로 센다 */
function awaitApprovals() {
  const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!
  minutes.summary = null
  minutes.summary_status = 'awaiting_approval'
}

describe('요약 상태', () => {
  it('요약을 만드는 중이면 그렇게 말하고 다시 시도 버튼도 내려받기도 없다', async () => {
    withoutSummary('pending')
    const panel = await openMinutes(MT_07, '2주차 정기회의')

    expect(within(panel).getByText('요약을 만드는 중이에요')).toBeInTheDocument()
    expect(
      within(panel).getByText('요약이 만들어지면 여기에 보여요. 발언은 전사문에서 볼 수 있어요.'),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(downloadButton()).toBeNull()
  })

  it('요약이 없고 상태가 none 이면 요약 칸을 비운다', async () => {
    withoutSummary('none')
    const panel = await openMinutes(MT_07, '2주차 정기회의')

    expect(panel).toBeEmptyDOMElement()
    expect(within(panel).queryByRole('heading')).toBeNull()
    expect(downloadButton()).toBeNull()
  })

  it('모르는 상태도 회의록을 거절하지 않고 중립 문구로 보인다', async () => {
    const served = structuredClone(db.minutes.find(({ meeting_id }) => meeting_id === 'mt_07')!)
    server.use(
      http.get('/api/v1/meetings/mt_07/minutes', () =>
        ok({ ...served, summary: null, summary_status: 'regenerating' }),
      ),
    )
    const panel = await openMinutes(MT_07, '2주차 정기회의')

    expect(within(panel).getByText('요약이 없어요')).toBeInTheDocument()
    expect(within(panel).queryByText('요약을 만드는 중이에요')).toBeNull()
  })

  it('승인을 기다리면 PM 은 남은 승인 대기 건수를 본다', async () => {
    awaitApprovals()
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText(AWAITING_TITLE)).toBeInTheDocument()
    expect(
      within(panel).getByText('승인 대기 3건이 남았어요. 발언은 전사문에서 볼 수 있어요.'),
    ).toBeInTheDocument()
    expect(downloadButton()).toBeNull()
  })

  it('승인을 기다리면 일반 팀원도 같은 제목을 보지만 건수는 보지 않는다', async () => {
    setMockRole('member')
    awaitApprovals()
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText(AWAITING_TITLE)).toBeInTheDocument()
    expect(within(panel).getByText('발언은 전사문에서 볼 수 있어요.')).toBeInTheDocument()
    expect(within(panel).queryByText(/승인 대기/)).toBeNull()
  })

  it.each([0, null])('남은 건수가 %s 로 오면 제목만 보이고 건수는 말하지 않는다', async (count) => {
    const served = structuredClone(db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!)
    server.use(
      http.get('/api/v1/meetings/mt_09/minutes', () =>
        ok({
          ...served,
          summary: null,
          summary_status: 'awaiting_approval',
          summary_waiting_count: count,
        }),
      ),
    )
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText(AWAITING_TITLE)).toBeInTheDocument()
    expect(within(panel).getByText('발언은 전사문에서 볼 수 있어요.')).toBeInTheDocument()
    expect(within(panel).queryByText(/승인 대기/)).toBeNull()
  })

  it('남은 승인 요청이 모두 처리됐으면 요약을 만드는 중이라고 말한다', async () => {
    awaitApprovals()
    for (const approval of db.approvals) approval.status = 'rejected'
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText('요약을 만드는 중이에요')).toBeInTheDocument()
    expect(within(panel).queryByText(AWAITING_TITLE)).toBeNull()
  })

  it('PM 이 카드 하나를 승인하고 돌아오면 남은 건수가 줄어 있다', async () => {
    awaitApprovals()
    db.approvals.find(({ approval_id }) => approval_id === 'ap_02')!.payload.due_date = '2026-09-30'
    const user = userEvent.setup()
    const app = renderApp(MT_09)
    expect(await screen.findByText(/승인 대기 3건이 남았어요/)).toBeInTheDocument()

    act(() => app.navigate(paths.approval('ws_01', 'ap_02')))
    const approve = await screen.findByRole('button', { name: '승인' })
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')

    act(() => app.navigate(MT_09))
    expect(await screen.findByText(/승인 대기 2건이 남았어요/)).toBeInTheDocument()
  })

  it('요약이 있으면 승인을 기다리는 상태여도 요약과 내려받기를 보인다', async () => {
    db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.summary_status =
      'awaiting_approval'
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText('인증 연동과 배포 준비 상황을 공유했다.')).toBeInTheDocument()
    expect(within(panel).queryByText(AWAITING_TITLE)).toBeNull()
    expect(downloadButton()).toBeInTheDocument()
  })

  it('요약이 있으면 상태가 pending 이어도 요약을 보인다', async () => {
    db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.summary_status = 'pending'
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    expect(within(panel).getByText('인증 연동과 배포 준비 상황을 공유했다.')).toBeInTheDocument()
    expect(within(panel).queryByText('요약을 만드는 중이에요')).toBeNull()
  })
})

describe('요약본 내려받기', () => {
  it('일반 팀원도 내려받고 서버가 준 한글 파일 이름으로 저장한다. 회의 삭제는 보이지 않는다', async () => {
    setMockRole('member')
    const saved = captureSavedFiles()
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    expect(screen.queryByRole('button', { name: '회의 삭제' })).toBeNull()
    await user.click(downloadButton()!)

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].filename).toBe('2026-09-15 3주차 정기회의.md')
    expect(saved[0].type).toBe('text/markdown;charset=utf-8')
    expect(await saved[0].text()).toContain('인증 연동과 배포 준비 상황을 공유했다.')
  })

  it('PM 에게는 내려받기와 회의 삭제가 함께 있다', async () => {
    await openMinutes(MT_09, '3주차 정기회의')

    expect(downloadButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회의 삭제' })).toBeInTheDocument()
  })

  it('요약본이 사라졌으면(404 SUMMARY_NOT_FOUND) 알림으로 알리고 버튼은 남는다', async () => {
    server.use(
      http.get('/api/v1/meetings/mt_09/summary.md', () =>
        fail('SUMMARY_NOT_FOUND', '이 회의의 요약본이 아직 없습니다.', 404),
      ),
    )
    const saved = captureSavedFiles()
    const user = userEvent.setup()
    await openMinutes(MT_09, '3주차 정기회의')

    await user.click(downloadButton()!)

    expect(await screen.findByText('이 회의의 요약본이 아직 없어요.')).toBeInTheDocument()
    expect(screen.getByText('요약본을 내려받지 못했어요')).toBeInTheDocument()
    expect(downloadButton()).toBeEnabled()
    expect(saved).toEqual([])
  })

  it('그 밖의 실패도 알림이고 화면은 그대로다', async () => {
    server.use(
      http.get('/api/v1/meetings/mt_09/summary.md', () => fail('INTERNAL_ERROR', 'boom', 500)),
    )
    const user = userEvent.setup()
    const panel = await openMinutes(MT_09, '3주차 정기회의')

    await user.click(downloadButton()!)

    expect(
      await screen.findByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('인증 연동과 배포 준비 상황을 공유했다.')).toBeInTheDocument()
  })
})
