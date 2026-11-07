import type { MeetingProgress, MeetingSource } from '@/entities/meeting'
import { processingSignal, signalAnnouncement } from './processingSignal'
import type { ProcessingSubject } from './processingSignal'

const TITLE = '3주차 정기회의'

const processing = (
  progress: MeetingProgress | null,
  source: MeetingSource | null = 'manual_upload',
): ProcessingSubject => ({
  phase: 'processing',
  title: TITLE,
  progress,
  source,
})

const AWAITING: ProcessingSubject = {
  phase: 'awaiting_speakers',
  title: TITLE,
  progress: { audioMerged: true, transcribed: true, extracted: false },
  source: 'manual_upload',
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
    expect(
      processingSignal({ ...FAILED, failedStage: 'speaker_assignment_expired' }, 'pm'),
    ).toMatchObject({
      description:
        '화자 지정 대기가 7일을 넘어 회의 정리가 종료됐어요. 다시 진행하려면 원본 파일을 다시 올려 주세요.',
    })
  })

  it.each([null, 'unknown_stage'])(
    '알 수 없는 실패(%s)의 설명은 카드 제목 문장을 되풀이하지 않는다',
    (failedStage) => {
      expect(processingSignal({ ...FAILED, failedStage }, 'pm')).toMatchObject({
        description: '파일을 다시 올려 주세요.',
      })
    },
  )

  it('팀원에게 실패는 아무것도 보이지 않는다', () => {
    expect(processingSignal(FAILED, 'member')).toBeNull()
  })
})

describe('정리 중 단계 문장 (#483)', () => {
  it.each([
    [{ audioMerged: false, transcribed: false, extracted: false }, '차례를 기다리고 있어요', 0],
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
  ])('녹음 회의는 지금 단계의 문장이다', (progress, sentence, doneCount) => {
    expect(processingSignal(processing(progress), 'pm')).toMatchObject({ sentence, doneCount })
  })

  it('넘기는 중(extracted 참, 아직 processing)에도 마지막 단계 진행 중이다', () => {
    expect(
      processingSignal(processing({ audioMerged: true, transcribed: true, extracted: true }), 'pm'),
    ).toMatchObject({
      sentence: '결정사항과 할 일을 뽑고 있어요',
      steps: ['done', 'done', 'current'],
      doneCount: 2,
    })
  })

  it('채팅 회의는 두 칸이다 — 대화 모으기 → 뽑아내기, 넘기는 중에도 둘째가 진행 중이다', () => {
    const none = { audioMerged: false, transcribed: false, extracted: false }
    expect(processingSignal(processing(none, 'chat'), 'pm')).toMatchObject({
      sentence: '대화를 모으고 있어요',
      steps: ['current', 'waiting'],
      doneCount: 0,
    })
    expect(
      processingSignal(
        processing({ audioMerged: true, transcribed: true, extracted: false }, 'chat'),
        'pm',
      ),
    ).toMatchObject({
      sentence: '결정사항과 할 일을 뽑고 있어요',
      steps: ['done', 'current'],
      doneCount: 1,
    })
    expect(
      processingSignal(
        processing({ audioMerged: true, transcribed: true, extracted: true }, 'chat'),
        'pm',
      ),
    ).toMatchObject({ steps: ['done', 'current'], doneCount: 1 })
  })

  it('progress 가 없는 옛 응답은 첫 단계부터다', () => {
    expect(processingSignal(processing(null), 'pm')).toMatchObject({
      sentence: '차례를 기다리고 있어요',
      steps: ['current', 'waiting', 'waiting'],
      doneCount: 0,
    })
  })

  it('출처를 모르면 단계 칸·수 없이 정리 중이라고만 한다 — 녹음 단계로 짐작하지 않는다', () => {
    const none = { audioMerged: false, transcribed: false, extracted: false }
    expect(processingSignal(processing(none, null), 'pm')).toEqual({
      kind: 'processing',
      title: TITLE,
      sentence: '회의를 정리하고 있어요',
      steps: null,
      doneCount: null,
    })
    expect(processingSignal({ ...AWAITING, source: null }, 'member')).toMatchObject({
      sentence: '화자 지정을 기다리고 있어요',
      steps: null,
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
