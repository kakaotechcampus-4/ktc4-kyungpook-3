import type { MeetingProgress } from '@/entities/meeting'
import { processingSignal, signalAnnouncement } from './processingSignal'
import type { ProcessingSubject } from './processingSignal'

const TITLE = '3주차 정기회의'

const processing = (progress: MeetingProgress | null): ProcessingSubject => ({
  phase: 'processing',
  title: TITLE,
  progress,
})

const AWAITING: ProcessingSubject = {
  phase: 'awaiting_speakers',
  title: TITLE,
  progress: { audioMerged: true, transcribed: true, extracted: false },
}
const DONE: ProcessingSubject = { phase: 'done', title: TITLE }
const FAILED: ProcessingSubject = { phase: 'failed', title: TITLE, failedStage: 'diarize' }

describe('진행 토스트의 역할 × 단계 (#424)', () => {
  it.each(['pm', 'member'] as const)('%s 는 정리 중을 단계 문장과 3칸 진행으로 본다', (role) => {
    expect(
      processingSignal(
        processing({ audioMerged: true, transcribed: false, extracted: false }),
        role,
      ),
    ).toEqual({
      kind: 'processing',
      title: TITLE,
      sentence: '음성을 텍스트로 옮기고 있어요',
      steps: ['done', 'current', 'waiting'],
      doneCount: 1,
    })
  })

  it('PM 은 화자 지정 대기를 화자 지정 토스트로 본다', () => {
    expect(processingSignal(AWAITING, 'pm')).toEqual({ kind: 'speakers', title: TITLE })
  })

  it('팀원은 화자 지정 대기를 정리 중 모양으로 본다 — 지금 단계 없이 기다린다는 문장이다', () => {
    expect(processingSignal(AWAITING, 'member')).toEqual({
      kind: 'processing',
      title: TITLE,
      sentence: '화자 지정을 기다리고 있어요',
      steps: ['done', 'done', 'waiting'],
      doneCount: 2,
    })
  })

  it.each(['pm', 'member'] as const)('%s 는 완료를 본다', (role) => {
    expect(processingSignal(DONE, role)).toEqual({ kind: 'done', title: TITLE })
  })

  it('PM 은 실패를 사유별 안내와 함께 본다', () => {
    expect(processingSignal(FAILED, 'pm')).toEqual({
      kind: 'failed',
      title: TITLE,
      description: '음성 처리 중 회의 정리를 완료하지 못했어요. 파일을 다시 올려 주세요.',
    })
    expect(processingSignal({ ...FAILED, failedStage: null }, 'pm')).toMatchObject({
      description: '회의를 정리하지 못했어요. 파일을 다시 올려 주세요.',
    })
  })

  it('팀원에게 실패는 아무것도 보이지 않는다', () => {
    expect(processingSignal(FAILED, 'member')).toBeNull()
  })
})

describe('정리 중 단계 문장', () => {
  it.each([
    [
      { audioMerged: false, transcribed: false, extracted: false },
      '음성 파일을 준비하고 있어요',
      0,
    ],
    [
      { audioMerged: true, transcribed: false, extracted: false },
      '음성을 텍스트로 옮기고 있어요',
      1,
    ],
    [
      { audioMerged: true, transcribed: true, extracted: false },
      '결정사항과 할 일을 뽑고 있어요',
      2,
    ],
  ])('지금 단계의 문장이다', (progress, sentence, doneCount) => {
    expect(processingSignal(processing(progress), 'pm')).toMatchObject({ sentence, doneCount })
  })

  it('지금 단계가 없으면(세 단계 모두 끝) 마지막 단계 문장을 그대로 쓴다', () => {
    expect(
      processingSignal(processing({ audioMerged: true, transcribed: true, extracted: true }), 'pm'),
    ).toMatchObject({
      sentence: '결정사항과 할 일을 뽑고 있어요',
      steps: ['done', 'done', 'done'],
      doneCount: 3,
    })
  })

  it('progress 가 없는 옛 응답은 첫 단계부터다', () => {
    expect(processingSignal(processing(null), 'pm')).toMatchObject({
      sentence: '음성 파일을 준비하고 있어요',
      steps: ['current', 'waiting', 'waiting'],
      doneCount: 0,
    })
  })
})

describe('화면 읽기 프로그램 알림', () => {
  it('정리 중은 단계 문장이고 진행 수를 넣지 않는다', () => {
    const signal = processingSignal(
      processing({ audioMerged: true, transcribed: false, extracted: false }),
      'pm',
    )
    expect(signal && signalAnnouncement(signal)).toBe('음성을 텍스트로 옮기고 있어요')
  })

  it.each([
    [AWAITING, '화자 지정이 필요해요'],
    [DONE, '회의 정리가 끝났어요'],
    [FAILED, '회의를 정리하지 못했어요'],
  ] as const)('끝난 상태와 화자 지정은 제목을 알린다', (subject, announcement) => {
    const signal = processingSignal(subject, 'pm')
    expect(signal && signalAnnouncement(signal)).toBe(announcement)
  })
})
