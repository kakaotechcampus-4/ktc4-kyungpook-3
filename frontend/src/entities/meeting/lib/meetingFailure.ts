const failures = {
  diarize: {
    title: '음성 처리를 완료하지 못했어요',
    description: '음성 처리 중 회의 정리를 완료하지 못했어요. 파일을 다시 올려 주세요.',
    reupload: true,
    expiredLabel: null,
  },
  speaker_assignment_expired: {
    title: '화자 지정 기한이 지났어요',
    description:
      '화자 지정 대기가 7일을 넘어 회의 정리가 종료됐어요. 다시 진행하려면 원본 파일을 다시 올려 주세요.',
    reupload: true,
    expiredLabel: '화자 지정 기한 만료',
  },
  // BE 는 실패를 저장한 뒤 녹음 정리를 시도하고 실패하면 다시 시도한다. 파일이 지워졌다고 말하지 않는다 (#563)
  upload_unclaimed: {
    title: '정리 시작 기한이 지났어요',
    description:
      '업로드 뒤 24시간 동안 정리가 시작되지 않아 회의 정리가 종료됐어요. 다시 진행하려면 원본 파일을 다시 올려 주세요.',
    reupload: true,
    expiredLabel: '정리 시작 기한 만료',
  },
  // 채팅 회의는 올린 파일이 없다. 끝난 채팅 회의만 수집 위치로 치므로 다음 수집이 같은 대화를 다시 모은다 (#450)
  chat_stalled: {
    title: '채팅 대화를 정리하지 못했어요',
    description: '채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.',
    reupload: false,
    expiredLabel: null,
  },
  unknown: {
    title: '회의를 정리하지 못했어요',
    description: '회의를 정리하지 못했어요. 파일을 다시 올려 주세요.',
    reupload: true,
    expiredLabel: null,
  },
} as const

/** `expiredLabel` 이 있는 사유는 수동 업로드 실패여도 목록에 이력으로 남는다(BE 목록 조건, 계약 §4.4.1) */
export function meetingFailure(stage: string | null) {
  switch (stage) {
    case 'diarize':
      return failures.diarize
    case 'speaker_assignment_expired':
      return failures.speaker_assignment_expired
    case 'upload_unclaimed':
      return failures.upload_unclaimed
    case 'chat_stalled':
      return failures.chat_stalled
    default:
      return failures.unknown
  }
}
