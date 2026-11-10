import type { MeetingProcessing, ProcessingStage } from '../model/types'
import { processingSteps } from './processingSteps'

const states = (...args: Parameters<typeof processingSteps>) =>
  processingSteps(...args).map(({ state }) => state)
const labels = (...args: Parameters<typeof processingSteps>) =>
  processingSteps(...args).map(({ label }) => label)

const NONE = { audioMerged: false, transcribed: false, extracted: false }
/** AI 가 stt 를 알렸다 */
const STT = { ...NONE, audioMerged: true }
/** 발화가 저장됐다(sources). 채팅 회의는 이때 앞 두 값이 함께 참이 된다 */
const SOURCES = { ...STT, transcribed: true }
/** AI 가 handoff 를 알렸다 — 회의는 아직 processing 이다 */
const HANDOFF = { ...SOURCES, extracted: true }

/** 서버가 정리 중이면 늘 주는 처리 단계. 보고 전은 stage null 이다 */
const reported = (stage: ProcessingStage | null): MeetingProcessing => ({
  stage,
  stageAt: stage === null ? null : '2026-09-18T00:00:00Z',
  stt: null,
})

const FIVE_LABELS = [
  '차례 기다리는 중',
  '음성을 텍스트로 옮기기',
  '회의록 정리하기',
  '결정사항과 할 일 뽑아내기',
  '정리 결과 보내기',
]

describe('processingSteps — 서버가 처리 단계를 알리는 녹음 회의 (#483)', () => {
  it('녹음·업로드 회의는 서버 단계와 1:1 인 다섯 단계다. 보고 전(stage null)도 다섯 단계다', () => {
    for (const source of ['discord', 'manual_upload'] as const)
      expect(labels(null, 'processing', source, reported(null))).toEqual(FIVE_LABELS)
  })

  it('서버 단계(대기 → stt → sources → extract → handoff)마다 그 단계가 진행 중이다', () => {
    expect(states(NONE, 'processing', 'discord', reported(null))).toEqual([
      'current',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ])
    expect(states(STT, 'processing', 'discord', reported('stt'))).toEqual([
      'done',
      'current',
      'waiting',
      'waiting',
      'waiting',
    ])
    expect(states(SOURCES, 'processing', 'discord', reported('sources'))).toEqual([
      'done',
      'done',
      'current',
      'waiting',
      'waiting',
    ])
    expect(states(SOURCES, 'processing', 'discord', reported('extract'))).toEqual([
      'done',
      'done',
      'done',
      'current',
      'waiting',
    ])
    expect(states(HANDOFF, 'processing', 'discord', reported('handoff'))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
    ])
  })

  it('보고 전(stage null)이면 progress 가 지금 단계를 정한다', () => {
    expect(states(STT, 'processing', 'manual_upload', reported(null))).toEqual([
      'done',
      'current',
      'waiting',
      'waiting',
      'waiting',
    ])
    expect(states(SOURCES, 'processing', 'manual_upload', reported(null))).toEqual([
      'done',
      'done',
      'current',
      'waiting',
      'waiting',
    ])
  })

  it('progress 가 서버 단계보다 앞서 있으면 그쪽을 믿는다 — 데이터가 이미 있으면 보고가 늦은 것이다', () => {
    expect(states(HANDOFF, 'processing', 'manual_upload', reported('sources'))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
    ])
    expect(states(SOURCES, 'processing', 'manual_upload', reported('stt'))).toEqual([
      'done',
      'done',
      'current',
      'waiting',
      'waiting',
    ])
  })

  it('서버 단계가 progress 보다 앞서 있어도 그쪽을 믿는다', () => {
    expect(states(NONE, 'processing', 'manual_upload', reported('extract'))).toEqual([
      'done',
      'done',
      'done',
      'current',
      'waiting',
    ])
  })

  it('정리 결과 보내기는 완료(done)가 되어야 끝난다. 완료 회의는 모두 끝났다', () => {
    expect(states(HANDOFF, 'processing', 'discord', reported('handoff'))[4]).toBe('current')
    expect(states(HANDOFF, 'done', 'discord', reported('handoff'))).toEqual(Array(5).fill('done'))
  })

  it('정리 중이 아니면 진행 중 단계를 만들지 않는다', () => {
    expect(states(SOURCES, 'failed', 'manual_upload', reported('sources'))).toEqual([
      'done',
      'done',
      'waiting',
      'waiting',
      'waiting',
    ])
  })

  it('화자 지정 대기는 서버가 처리 단계를 주지 않아도 다섯 단계이고 진행 중 단계가 없다', () => {
    expect(states(STT, 'awaiting_speakers', 'manual_upload', null)).toEqual([
      'done',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ])
  })

  it('채팅 회의는 처리 단계가 있어도 대화 모으기 → 뽑아내기 두 단계이고 progress 로만 정한다', () => {
    expect(labels(NONE, 'processing', 'chat', reported('extract'))).toEqual([
      '대화 모으기',
      '결정사항과 할 일 뽑아내기',
    ])
    expect(states(NONE, 'processing', 'chat', reported('extract'))).toEqual(['current', 'waiting'])
  })
})

describe('processingSteps — 처리 단계가 없는 옛 응답 (U4-4, #483)', () => {
  it('녹음·업로드 회의는 차례 기다리기 → 텍스트로 옮기기 → 뽑아내기 세 단계다', () => {
    for (const source of ['discord', 'manual_upload'] as const)
      expect(labels(null, 'processing', source, null)).toEqual([
        '차례 기다리는 중',
        '음성을 텍스트로 옮기기',
        '결정사항과 할 일 뽑아내기',
      ])
  })

  it('채팅 회의는 대화 모으기 → 뽑아내기 두 단계다', () => {
    expect(labels(null, 'processing', 'chat', null)).toEqual([
      '대화 모으기',
      '결정사항과 할 일 뽑아내기',
    ])
  })

  it('녹음 회의는 서버 순서(대기 → stt → sources → handoff)대로 한 단계씩 진행 중이다', () => {
    expect(states(NONE, 'processing', 'manual_upload', null)).toEqual([
      'current',
      'waiting',
      'waiting',
    ])
    expect(states(STT, 'processing', 'manual_upload', null)).toEqual(['done', 'current', 'waiting'])
    expect(states(SOURCES, 'processing', 'manual_upload', null)).toEqual([
      'done',
      'done',
      'current',
    ])
  })

  it('넘기는 중(extracted 참, 아직 processing)에도 마지막 단계는 진행 중이다', () => {
    expect(states(HANDOFF, 'processing', 'discord', null)).toEqual(['done', 'done', 'current'])
    expect(states(HANDOFF, 'processing', 'chat', null)).toEqual(['done', 'current'])
  })

  it('채팅 회의는 발화가 저장되기 전까지 대화 모으기, 그 뒤 done 까지 뽑아내기다', () => {
    expect(states(NONE, 'processing', 'chat', null)).toEqual(['current', 'waiting'])
    expect(states(SOURCES, 'processing', 'chat', null)).toEqual(['done', 'current'])
    expect(states(null, 'done', 'chat', null)).toEqual(['done', 'done'])
  })

  it('progress 가 없으면 첫 단계부터다. 완료 회의는 모두 끝났다', () => {
    expect(states(null, 'processing', 'manual_upload', null)).toEqual([
      'current',
      'waiting',
      'waiting',
    ])
    expect(states(null, 'done', 'manual_upload', null)).toEqual(['done', 'done', 'done'])
  })

  it('정리 중이 아니면 진행 중 단계를 만들지 않는다', () => {
    expect(states(STT, 'failed', 'manual_upload', null)).toEqual(['done', 'waiting', 'waiting'])
  })

  it('#383 뒤 extracted 가 남은 회의 — 완료는 모두 끝, 실패는 마지막 단계를 끝내지 않았다 (#384)', () => {
    expect(states(HANDOFF, 'done', 'manual_upload', null)).toEqual(['done', 'done', 'done'])
    expect(states(SOURCES, 'done', 'manual_upload', null)).toEqual(['done', 'done', 'done'])
    expect(states(HANDOFF, 'failed', 'manual_upload', null)).toEqual(['done', 'done', 'waiting'])
  })
})

it('단계마다 백분율·시간 같은 숫자를 내지 않는다 (U4-4)', () => {
  for (const processing of [null, reported('stt')])
    for (const step of processingSteps(SOURCES, 'processing', 'manual_upload', processing))
      expect(Object.values(step).some((value) => typeof value === 'number')).toBe(false)
})
