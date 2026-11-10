import type { MeetingProcessing, MeetingSource } from '../model/types'
import { processingSteps } from './processingSteps'
import type { ProcessingStepKey } from './processingSteps'
import { elapsedText, stageDetail, sttProgressText } from './stageDetail'

const NOW = Date.parse('2026-09-18T00:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const stt = (done: number, total: number, startedMinutesAgo = 4): MeetingProcessing => ({
  stage: 'stt',
  stageAt: minutesAgo(startedMinutesAgo),
  stt: { done, total },
})

const NO_REPORT: MeetingProcessing = { stage: null, stageAt: null, stt: null }

/** 처리 화면이 그리는 단계 하나. 녹음 회의는 다섯 단계, 채팅 회의는 두 단계 목록에서 꺼낸다 */
const step = (key: ProcessingStepKey, source: MeetingSource = 'manual_upload') => {
  const found = processingSteps(null, 'processing', source, NO_REPORT).find(
    (candidate) => candidate.key === key,
  )
  if (found === undefined) throw new Error(`no ${key} step for ${source}`)
  return found
}

describe('지금 단계의 보조 표시 (#483)', () => {
  it('전사 중이면 진행 수와 stt 를 알린 뒤의 경과다', () => {
    expect(stageDetail(stt(3, 5), step('transcribe'), NOW)).toEqual({
      stt: { done: 3, total: 5 },
      elapsedMinutes: 4,
    })
  })

  it('녹음 회의의 정리·뽑아내기·보내기는 1:1 인 서버 단계의 경과만이다 — stt 값이 남아 있어도 보이지 않는다', () => {
    for (const [key, stage] of [
      ['organize', 'sources'],
      ['extract', 'extract'],
      ['deliver', 'handoff'],
    ] as const)
      expect(
        stageDetail({ stage, stageAt: minutesAgo(2), stt: { done: 5, total: 5 } }, step(key), NOW),
      ).toEqual({ stt: null, elapsedMinutes: 2 })
  })

  it('녹음 회의의 한 단계는 다른 서버 단계의 경과를 붙이지 않는다', () => {
    for (const [key, stage] of [
      ['organize', 'extract'],
      ['extract', 'sources'],
      ['extract', 'handoff'],
      ['deliver', 'extract'],
    ] as const)
      expect(stageDetail({ stage, stageAt: minutesAgo(2), stt: null }, step(key), NOW)).toBeNull()
  })

  it('채팅 회의의 뽑아내기는 sources·extract·handoff 모두의 경과다', () => {
    for (const stage of ['sources', 'extract', 'handoff'] as const)
      expect(
        stageDetail({ stage, stageAt: minutesAgo(2), stt: null }, step('extract', 'chat'), NOW),
      ).toEqual({ stt: null, elapsedMinutes: 2 })
  })

  it.each([
    ['서버 단계가 화면의 지금 단계에 속하지 않으면', stt(3, 5), 'organize'],
    ['대기 단계', stt(3, 5), 'queue'],
    ['지금 단계가 없으면', stt(3, 5), undefined],
    ['서버가 단계를 알리지 않았으면', NO_REPORT, 'transcribe'],
    ['processing 이 없으면', null, 'transcribe'],
    ['진행 수도 시각도 없으면', { stage: 'stt', stageAt: null, stt: null }, 'transcribe'],
  ] as const)('%s 붙이지 않는다', (_, processing, key) => {
    expect(stageDetail(processing, key === undefined ? undefined : step(key), NOW)).toBeNull()
  })

  it('시각을 읽을 수 없으면 진행 수만이다', () => {
    expect(
      stageDetail(
        { stage: 'stt', stageAt: 'yesterday', stt: { done: 1, total: 2 } },
        step('transcribe'),
        NOW,
      ),
    ).toEqual({ stt: { done: 1, total: 2 }, elapsedMinutes: null })
  })

  it('서버 시각이 앞서 있어 음수가 되면 0분이다', () => {
    expect(stageDetail(stt(0, 5, -3), step('transcribe'), NOW)).toMatchObject({ elapsedMinutes: 0 })
  })
})

describe('문구', () => {
  it('진행 수는 음성 트랙 3/5 로 보이고 화면 읽기 프로그램에는 음성 트랙 5개 중 3개 완료 로 읽힌다', () => {
    expect(sttProgressText({ done: 3, total: 5 })).toEqual({
      shown: '음성 트랙 3/5',
      spoken: '음성 트랙 5개 중 3개 완료',
    })
  })

  it.each([
    [0, '방금 시작'],
    [1, '1분째'],
    [59, '59분째'],
    [60, '1시간째'],
    [61, '1시간 1분째'],
    [125, '2시간 5분째'],
  ])('%i분은 %s', (minutes, text) => {
    expect(elapsedText(minutes)).toBe(text)
  })
})
