const failures = {
  diarize: {
    kind: 'diarize',
    title: '음성 처리를 완료하지 못했어요',
    description: '음성 처리 중 회의 정리를 완료하지 못했어요. 파일을 다시 올려 주세요.',
  },
  speaker_assignment_expired: {
    kind: 'expired',
    title: '화자 지정 기한이 지났어요',
    description:
      '화자 지정 대기가 7일을 넘어 회의 정리가 종료됐어요. 다시 진행하려면 원본 파일을 다시 올려 주세요.',
  },
  unknown: {
    kind: 'unknown',
    title: '회의를 정리하지 못했어요',
    description: '회의를 정리하지 못했어요. 파일을 다시 올려 주세요.',
  },
} as const

export function meetingFailure(stage: string | null) {
  switch (stage) {
    case 'diarize':
      return failures.diarize
    case 'speaker_assignment_expired':
      return failures.speaker_assignment_expired
    default:
      return failures.unknown
  }
}
