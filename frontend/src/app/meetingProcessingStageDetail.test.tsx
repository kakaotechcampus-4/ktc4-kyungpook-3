import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { renderApp } from './test/renderApp'

/*
 * #483 A안 — 지금 단계 옆의 전사 진행 수와 경과. 서버 `processing`(BE #542)을 실제 경로·MSW 로 그린다.
 * 픽스처 mt_10(기획 논의 녹음, 업로드)은 정리 중이고 progress 가 「음성을 텍스트로 옮기기」 진행 중이다.
 * 경과는 응답을 받은 시각 기준이라 Date 만 고정한다
 */

const NOW = Date.parse('2026-09-18T00:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

/** 진행 수·경과가 없을 때의 단계 줄. 진행 수를 붙이기 전과 같아야 한다 */
const PLAIN_ROWS = [
  '차례 기다리는 중완료',
  '음성을 텍스트로 옮기기진행 중',
  '결정사항과 할 일 뽑아내기대기',
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

function mt10() {
  return db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
}

function report(processing: ReturnType<typeof mt10>['processing']) {
  mt10().processing = processing
}

/** 서버가 준 상세 그대로 내린다. 키를 빼거나 모양이 틀린 처리 단계를 보낸다 */
function answerDetail(patch: (dto: Record<string, unknown>) => void) {
  server.use(
    http.get('/api/v1/meetings/mt_10', () => {
      const dto: Record<string, unknown> = { ...structuredClone(mt10()) }
      patch(dto)
      return ok(dto)
    }),
  )
}

/** 화면에 보이는 글. 화면 읽기 프로그램 전용 글(sr-only)을 뺀다 */
function shown(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove())
  return copy.textContent ?? ''
}

/** 화면 읽기 프로그램이 읽는 글. aria-hidden 을 뺀다 */
function spoken(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
  return copy.textContent ?? ''
}

async function openProcessing() {
  renderApp(paths.meetingProcessing('ws_01', 'mt_10'))
  expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
  const rows = () =>
    within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
  await waitFor(() => expect(rows()).toHaveLength(3))
  return rows
}

/** 시계를 `at` 으로 옮기고 polling 한 번(3초)을 돌린다. 응답 내용은 그대로다 */
async function poll(at: number) {
  vi.setSystemTime(at)
  await act(() => vi.advanceTimersByTimeAsync(3_000))
}

function silenceWarnings() {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => warning.mockRestore())
}

describe('처리 화면 — 지금 단계의 진행 수·경과 (#483)', () => {
  it('전사 중이면 지금 단계 줄에 음성 트랙 3/5 · 4분째 를 보이고 화면 읽기 프로그램은 「음성 트랙 5개 중 3개 완료」로 읽는다', async () => {
    report({ stage: 'stt', stage_at: minutesAgo(4), stt: { done: 3, total: 5 } })
    const rows = await openProcessing()

    const current = rows()[1]
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(shown(current)).toBe('음성을 텍스트로 옮기기음성 트랙 3/5 · 4분째진행 중')
    expect(spoken(current)).toBe('음성을 텍스트로 옮기기음성 트랙 5개 중 3개 완료, 4분째진행 중')
    expect(
      rows()
        .map((row) => row.textContent)
        .filter((text) => text?.includes('분째')),
    ).toHaveLength(1)
    // 단계 알림은 단계가 바뀔 때만 읽힌다 — 진행 수를 넣지 않는다
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      /^1 \/ 3 단계 완료 · 음성을 텍스트로 옮기기 진행 중$/,
    )
  })

  it('AI 가 아직 진행을 알리지 않았으면(stage·stt null) 단계 줄은 지금과 같다', async () => {
    report({ stage: null, stage_at: null, stt: null })
    const rows = await openProcessing()
    expect(rows().map((row) => row.textContent)).toEqual(PLAIN_ROWS)
  })

  it('processing 키가 없는 옛 서버(#542 전)도 단계 줄은 지금과 같다', async () => {
    answerDetail((dto) => delete dto.processing)
    const rows = await openProcessing()
    expect(rows().map((row) => row.textContent)).toEqual(PLAIN_ROWS)
  })

  it.each([
    [
      '끝낸 수가 전체보다 많은 진행',
      { stage: 'stt', stage_at: minutesAgo(4), stt: { done: 6, total: 5 } },
    ],
    ['문자열 진행', { stage: 'stt', stage_at: minutesAgo(4), stt: '3/5' }],
    ['문자열 processing', 'stt'],
  ])('%s 은 진행 수·경과만 빼고 제목·단계는 그대로 보인다', async (_, processing) => {
    silenceWarnings()
    answerDetail((dto) => (dto.processing = processing))
    const rows = await openProcessing()
    expect(rows().map((row) => row.textContent)).toEqual(PLAIN_ROWS)
    expect(screen.queryByText('정리 상태를 불러오지 못했어요')).toBeNull()
  })

  it('모르는 단계는 진행 수·경과를 붙이지 않는다', async () => {
    silenceWarnings()
    report({ stage: 'diarize', stage_at: minutesAgo(4), stt: { done: 3, total: 5 } })
    const rows = await openProcessing()
    expect(rows().map((row) => row.textContent)).toEqual(PLAIN_ROWS)
  })

  it.each([
    ['1분 미만', minutesAgo(0.5), '음성을 텍스트로 옮기기음성 트랙 1/2 · 방금 시작진행 중'],
    [
      '서버 시각이 앞선(음수) 경과',
      minutesAgo(-2),
      '음성을 텍스트로 옮기기음성 트랙 1/2 · 방금 시작진행 중',
    ],
    ['60분 이상', minutesAgo(125), '음성을 텍스트로 옮기기음성 트랙 1/2 · 2시간 5분째진행 중'],
  ])('%s 경과를 분·시간 문구로 보인다', async (_, stageAt, row) => {
    report({ stage: 'stt', stage_at: stageAt, stt: { done: 1, total: 2 } })
    const rows = await openProcessing()
    expect(shown(rows()[1])).toBe(row)
  })

  it('긴 트랙 하나가 끝나지 않아 진행 수가 그대로여도 조회마다 경과는 오른다 (AI #653)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW })
    report({ stage: 'stt', stage_at: minutesAgo(4), stt: { done: 0, total: 1 } })
    const rows = await openProcessing()
    expect(shown(rows()[1])).toBe('음성을 텍스트로 옮기기음성 트랙 0/1 · 4분째진행 중')

    await poll(NOW + 60_000)
    await waitFor(() =>
      expect(shown(rows()[1])).toBe('음성을 텍스트로 옮기기음성 트랙 0/1 · 5분째진행 중'),
    )
    await poll(NOW + 57 * 60_000)
    await waitFor(() =>
      expect(shown(rows()[1])).toBe('음성을 텍스트로 옮기기음성 트랙 0/1 · 1시간 1분째진행 중'),
    )
  })

  it('단계가 바뀌면 다음 조회 뒤 새 단계 줄에 그 단계의 경과만 보인다 — 진행 수는 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW })
    report({ stage: 'stt', stage_at: minutesAgo(4), stt: { done: 3, total: 5 } })
    const rows = await openProcessing()
    expect(shown(rows()[1])).toContain('음성 트랙 3/5 · 4분째')

    mt10().progress = { audio_merged: true, transcribed: true, extracted: true }
    report({ stage: 'handoff', stage_at: minutesAgo(1), stt: { done: 5, total: 5 } })
    await act(() => vi.advanceTimersByTimeAsync(3_000))

    await waitFor(() => expect(shown(rows()[2])).toBe('결정사항과 할 일 뽑아내기1분째진행 중'))
    expect(
      rows()
        .map((row) => row.textContent)
        .slice(0, 2),
    ).toEqual(['차례 기다리는 중완료', '음성을 텍스트로 옮기기완료'])
  })
})

describe('진행 토스트 — 펼친 카드의 진행 수·경과 (#483)', () => {
  async function openCard() {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW })
    renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    const pill = await screen.findByRole('button', { name: /펼치기/ })
    expect(pill).toHaveTextContent('정리 중1/3')
    fireEvent.click(pill)
    return screen.findByRole('region', { name: /정리 중$/ })
  }

  const announcement = () =>
    document.querySelector<HTMLElement>('[data-testid="pinned-toast-slot"] [role="status"]')

  it('전사 중이면 문장 아래 음성 트랙 3/5 · 4분째 이고, 알림 문장에는 숫자가 없다', async () => {
    report({ stage: 'stt', stage_at: minutesAgo(4), stt: { done: 3, total: 5 } })
    const card = await openCard()
    expect(card).toHaveTextContent('음성을 텍스트로 옮기고 있어요')
    expect(shown(card)).toContain('음성을 텍스트로 옮기고 있어요음성 트랙 3/5 · 4분째')
    expect(spoken(card)).toContain('음성 트랙 5개 중 3개 완료, 4분째')
    expect(announcement()).toHaveTextContent(/^음성을 텍스트로 옮기고 있어요$/)
  })

  it('긴 트랙 하나가 끝나지 않아도 카드의 경과는 조회마다 오른다 (AI #653)', async () => {
    report({ stage: 'stt', stage_at: minutesAgo(4), stt: { done: 0, total: 1 } })
    const card = await openCard()
    expect(shown(card)).toContain('음성 트랙 0/1 · 4분째')

    await poll(NOW + 60_000)
    await waitFor(() => expect(shown(card)).toContain('음성 트랙 0/1 · 5분째'))
    expect(announcement()).toHaveTextContent(/^음성을 텍스트로 옮기고 있어요$/)
  })

  it('processing 이 없으면 카드는 지금과 같다', async () => {
    report(null)
    const card = await openCard()
    expect(shown(card)).toBe(
      '기획 논의 녹음 정리 중음성을 텍스트로 옮기고 있어요1 / 3 단계 완료자세히 보기',
    )
  })
})
