import { screen, within } from '@testing-library/react'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { failMeeting } from '@/shared/mock/meetingFlow'
import { renderApp } from './test/renderApp'

/*
 * #384 — BE PR #383 뒤의 progress 시점. AI 가 단계를 알리는 회의는 인계(handoff)에 들어가면 extracted 가 true 이고,
 * 그 값이 done·failed 뒤에도 남는다. 처리 화면이 그 값으로 잘못 그리지 않는지 실제 경로·MSW 로 본다.
 */

const ALL_DONE = { audio_merged: true, transcribed: true, extracted: true }

function meeting(meetingId: string) {
  const found = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!found) throw new Error(`fixture meeting ${meetingId} is missing`)
  return found
}

describe('처리 화면과 #383 의 progress (#384)', () => {
  it('인계 중이면 세 단계가 모두 끝났지만 아직 정리 중이다', async () => {
    meeting('mt_10').progress = ALL_DONE
    renderApp(paths.meetingProcessing('ws_01', 'mt_10'))

    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '음성 파일 준비하기완료',
      '음성을 텍스트로 옮기기완료',
      '결정사항과 할 일 뽑아내기완료',
    ])
    expect(steps.filter((step) => step.hasAttribute('aria-current'))).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent(/^3 \/ 3 단계 완료$/)
  })

  it.each([
    ['단계를 알린 회의(#383 뒤)', ALL_DONE],
    ['데이터로 판정한 회의', { audio_merged: true, transcribed: true, extracted: false }],
  ])(
    '항목 0개로 끝난 회의는 extracted 와 관계없이 정리가 끝난 화면이다 — %s',
    async (_, progress) => {
      const done = meeting('mt_07')
      expect(done.status).toBe('done')
      done.progress = progress
      renderApp(paths.meetingProcessing('ws_01', 'mt_07'))

      expect(await screen.findByRole('heading', { name: '정리가 끝났어요' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: '회의록 보기' })).toHaveAttribute(
        'href',
        paths.meetings('ws_01', 'mt_07'),
      )
      expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()
      expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
        '정리가 끝났어요',
      )
    },
  )

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
