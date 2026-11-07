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

describe('processingSteps (U4-4, #483)', () => {
  it('녹음·업로드 회의는 차례 기다리기 → 텍스트로 옮기기 → 뽑아내기 세 단계다', () => {
    for (const source of ['discord', 'manual_upload', null] as const)
      expect(labels(null, 'processing', source)).toEqual([
        '차례 기다리는 중',
        '음성을 텍스트로 옮기기',
        '결정사항과 할 일 뽑아내기',
      ])
  })

  it('채팅 회의는 대화 모으기 → 뽑아내기 두 단계다', () => {
    expect(labels(null, 'processing', 'chat')).toEqual(['대화 모으기', '결정사항과 할 일 뽑아내기'])
  })

  it('녹음 회의는 서버 순서(대기 → stt → sources → handoff)대로 한 단계씩 진행 중이다', () => {
    expect(states(NONE, 'processing', 'manual_upload')).toEqual(['current', 'waiting', 'waiting'])
    expect(states(STT, 'processing', 'manual_upload')).toEqual(['done', 'current', 'waiting'])
    expect(states(SOURCES, 'processing', 'manual_upload')).toEqual(['done', 'done', 'current'])
  })

  it('넘기는 중(extracted 참, 아직 processing)에도 마지막 단계는 진행 중이다', () => {
    expect(states(HANDOFF, 'processing', 'discord')).toEqual(['done', 'done', 'current'])
    expect(states(HANDOFF, 'processing', 'chat')).toEqual(['done', 'current'])
  })

  it('채팅 회의는 발화가 저장되기 전까지 대화 모으기, 그 뒤 done 까지 뽑아내기다', () => {
    expect(states(NONE, 'processing', 'chat')).toEqual(['current', 'waiting'])
    expect(states(SOURCES, 'processing', 'chat')).toEqual(['done', 'current'])
    expect(states(null, 'done', 'chat')).toEqual(['done', 'done'])
  })

  it('progress 가 없으면 첫 단계부터다. 완료 회의는 모두 끝났다', () => {
    expect(states(null, 'processing', null)).toEqual(['current', 'waiting', 'waiting'])
    expect(states(null, 'done', null)).toEqual(['done', 'done', 'done'])
  })

  it('정리 중이 아니면 진행 중 단계를 만들지 않는다', () => {
    expect(states(STT, 'failed', null)).toEqual(['done', 'waiting', 'waiting'])
    expect(states(SOURCES, 'awaiting_speakers', 'manual_upload')).toEqual([
      'done',
      'done',
      'waiting',
    ])
  })

  it('#383 뒤 extracted 가 남은 회의 — 완료는 모두 끝, 실패는 마지막 단계를 끝내지 않았다 (#384)', () => {
    expect(states(HANDOFF, 'done', null)).toEqual(['done', 'done', 'done'])
    expect(states(SOURCES, 'done', null)).toEqual(['done', 'done', 'done'])
    expect(states(HANDOFF, 'failed', null)).toEqual(['done', 'done', 'waiting'])
  })

  it('단계 이름 말고 숫자(백분율·시간)를 내지 않는다', () => {
    for (const step of processingSteps(null, 'processing', null))
      expect(Object.keys(step).sort()).toEqual(['key', 'label', 'state'])
  })
})
