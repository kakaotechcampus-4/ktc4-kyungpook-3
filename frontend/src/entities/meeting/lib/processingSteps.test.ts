import { PROCESSING_STEP_COUNT, processingSteps } from './processingSteps'

const states = (...args: Parameters<typeof processingSteps>) =>
  processingSteps(...args).map(({ state }) => state)

describe('processingSteps (U4-4)', () => {
  it('서버의 progress 세 값이 곧 세 단계다', () => {
    expect(PROCESSING_STEP_COUNT).toBe(3)
    expect(processingSteps(null, 'processing').map(({ key }) => key)).toEqual([
      'audioMerged',
      'transcribed',
      'extracted',
    ])
  })

  it('끝난 단계는 done, 정리 중이면 끝나지 않은 첫 단계만 current 다', () => {
    const none = { audioMerged: false, transcribed: false, extracted: false }
    expect(states(none, 'processing')).toEqual(['current', 'waiting', 'waiting'])
    expect(states({ ...none, audioMerged: true }, 'processing')).toEqual([
      'done',
      'current',
      'waiting',
    ])
    expect(
      states({ audioMerged: true, transcribed: true, extracted: false }, 'processing'),
    ).toEqual(['done', 'done', 'current'])
    expect(states({ audioMerged: true, transcribed: true, extracted: true }, 'processing')).toEqual(
      ['done', 'done', 'done'],
    )
  })

  it('progress 가 없으면 첫 단계부터다. 완료 회의는 모두 끝났다', () => {
    expect(states(null, 'processing')).toEqual(['current', 'waiting', 'waiting'])
    expect(states(null, 'done')).toEqual(['done', 'done', 'done'])
  })

  it('정리 중이 아니면 진행 중 단계를 만들지 않는다', () => {
    const half = { audioMerged: true, transcribed: false, extracted: false }
    expect(states(half, 'failed')).toEqual(['done', 'waiting', 'waiting'])
  })

  it('단계 이름 말고 숫자(백분율·시간)를 내지 않는다', () => {
    for (const step of processingSteps(null, 'processing'))
      expect(Object.keys(step).sort()).toEqual(['key', 'label', 'state'])
  })
})
