import { screen, waitFor, within } from '@testing-library/react'
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
        ok({ ...served, summary: null, summary_status: 'awaiting_approval' }),
      ),
    )
    const panel = await openMinutes(MT_07, '2주차 정기회의')

    expect(within(panel).getByText('요약이 없어요')).toBeInTheDocument()
    expect(within(panel).queryByText('요약을 만드는 중이에요')).toBeNull()
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
