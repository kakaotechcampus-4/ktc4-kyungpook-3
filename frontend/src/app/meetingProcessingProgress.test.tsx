import { act, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { completeMeeting, failMeeting, startChatMeeting } from '@/shared/mock/meetingFlow'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #384·#483 — BE PR #383 뒤의 progress 시점. AI 가 단계를 알리는 회의는 인계(handoff)에 들어가면 extracted 가 true 이고,
 * 그 값이 done·failed 뒤에도 남는다. 처리 화면이 그 값으로 잘못 그리지 않는지 실제 경로·MSW 로 본다.
 */

const ALL_DONE = { audio_merged: true, transcribed: true, extracted: true }

function meeting(meetingId: string) {
  const found = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!found) throw new Error(`fixture meeting ${meetingId} is missing`)
  return found
}

describe('처리 화면과 #383 의 progress (#384)', () => {
  it('인계 중이면 extracted 가 참이어도 마지막 단계 정리 결과 보내기는 아직 진행 중이다 (#483)', async () => {
    meeting('mt_10').progress = ALL_DONE
    renderApp(paths.meetingProcessing('ws_01', 'mt_10'))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '차례 기다리는 중완료',
      '음성을 텍스트로 옮기기완료',
      '회의록 정리하기완료',
      '결정사항과 할 일 뽑아내기완료',
      '정리 결과 보내기진행 중',
    ])
    expect(steps[4]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('status')).toHaveTextContent(
      /^4 \/ 5 단계 완료 · 정리 결과 보내기 진행 중$/,
    )
  })

  it('처리 단계가 없는 옛 서버(#542 전)는 세 단계이고, 인계 중에도 뽑아내기가 진행 중이다 (#483)', async () => {
    meeting('mt_10').progress = ALL_DONE
    server.use(
      http.get('/api/v1/meetings/mt_10', () => {
        const legacy: Record<string, unknown> = { ...structuredClone(meeting('mt_10')) }
        delete legacy.processing
        return ok(legacy)
      }),
    )
    renderApp(paths.meetingProcessing('ws_01', 'mt_10'))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '차례 기다리는 중완료',
      '음성을 텍스트로 옮기기완료',
      '결정사항과 할 일 뽑아내기진행 중',
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      /^2 \/ 3 단계 완료 · 결정사항과 할 일 뽑아내기 진행 중$/,
    )
  })

  it('채팅 회의는 대화 모으기 → 뽑아내기 두 단계이고 넘기는 중에도 둘째가 진행 중이다 (#483)', async () => {
    completeMeeting('mt_10')
    const chatId = startChatMeeting()
    renderApp(paths.meetingProcessing('ws_01', chatId))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const rows = () =>
      within(screen.getByRole('list', { name: '정리 단계' }))
        .getAllByRole('listitem')
        .map((step) => step.textContent)
    expect(rows()).toEqual(['대화 모으기진행 중', '결정사항과 할 일 뽑아내기대기'])
    expect(screen.getByRole('status')).toHaveTextContent(/^0 \/ 2 단계 완료 · 대화 모으기 진행 중$/)
  })

  it.each([
    ['발화가 저장된 뒤', { audio_merged: true, transcribed: true, extracted: false }],
    ['넘기는 중', ALL_DONE],
  ])('채팅 회의 — %s 는 1 / 2 이고 뽑아내기가 진행 중이다 (#483)', async (_, progress) => {
    completeMeeting('mt_10')
    const chatId = startChatMeeting()
    meeting(chatId).progress = progress
    renderApp(paths.meetingProcessing('ws_01', chatId))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '대화 모으기완료',
      '결정사항과 할 일 뽑아내기진행 중',
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      /^1 \/ 2 단계 완료 · 결정사항과 할 일 뽑아내기 진행 중$/,
    )
  })

  it.each([
    ['단계를 알린 회의(#383 뒤)', ALL_DONE],
    ['데이터로 판정한 회의', { audio_merged: true, transcribed: true, extracted: false }],
  ])('항목 0개로 끝난 회의도 완료 화면 없이 회의록으로 바로 이동한다 — %s', async (_, progress) => {
    const done = meeting('mt_07')
    expect(done.status).toBe('done')
    done.progress = progress
    const app = renderApp(paths.meetingProcessing('ws_01', 'mt_07'))

    await app.expectPath(paths.meetings('ws_01', 'mt_07'))
    expect(screen.queryByRole('heading', { name: '정리가 끝났어요' })).toBeNull()
    expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()
  })

  it('인계 단계에서 실패한 회의는 extracted 가 true 여도 실패 화면이고 단계를 완료로 보이지 않는다', async () => {
    meeting('mt_10').progress = ALL_DONE
    failMeeting('mt_10', { failedStage: 'handoff' })
    renderApp(paths.meetingProcessing('ws_01', 'mt_10'))

    expect(
      await screen.findByRole('heading', { name: '회의를 정리하지 못했어요' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '실패 사유 보기' })).toHaveAttribute(
      'href',
      paths.meetings('ws_01', 'mt_10'),
    )
    expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()
    expect(screen.getByRole('main')).not.toHaveTextContent('단계 완료')
  })
})

const LIST = '/api/v1/workspaces/ws_01/meetings'

/** 처리 화면의 단계 안내(role=status)가 지나간 문장. 같은 문장이 이어지면 하나다 */
function recordAnnouncements() {
  const seen: string[] = []
  const observer = new MutationObserver(() => {
    const text = document.querySelector('main [role="status"]')?.textContent ?? ''
    if (text !== '' && seen.at(-1) !== text) seen.push(text)
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  onTestFinished(() => observer.disconnect())
  return seen
}

describe('출처를 모를 때 — 단계 수를 짐작하지 않는다 (#483 리뷰)', () => {
  it('받아 둔 최신 목록에 없는 채팅 회의로 들어오면 목록을 한 번 새로 받고, 그동안 단계를 그리지 않는다', async () => {
    const app = renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    const log = recordRequests()
    // 목록을 받은 뒤 생긴 채팅 회의. 목록 캐시(30초)는 아직 최신이다
    const chatId = startChatMeeting()
    const seen = recordAnnouncements()

    act(() => app.navigate(paths.meetingProcessing('ws_01', chatId)))
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    await waitFor(() =>
      expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
        /^0 \/ 2 단계 완료 · 대화 모으기 진행 중$/,
      ),
    )
    expect(seen.filter((text) => text.includes('/ 3'))).toEqual([])
    expect(
      log.started.filter(
        ({ method, path }) => method === 'GET' && path === '/workspaces/ws_01/meetings',
      ),
    ).toHaveLength(1)
  })

  it('목록 조회가 실패하면 녹음 단계로 짐작하지 않고 단계 없이 정리 중이라고만 한다', async () => {
    server.use(http.get(LIST, () => fail('INTERNAL_ERROR', '서버 오류', 500)))
    const chatId = startChatMeeting()
    renderApp(paths.meetingProcessing('ws_01', chatId))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/^정리하고 있어요$/)
    expect(screen.getByRole('main')).not.toHaveTextContent('단계 완료')
  })
})
