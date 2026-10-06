/**
 * 회의 음성 업로드 한도. 근거: docs/impl-decision/2026-10-02-meeting-upload-policy.md
 * 서버는 아직 크기·길이·형식을 검사하지 않는다(계약 §4.4). 화면이 제출 전에 막는다.
 * 경계값은 허용이다 — 정확히 200 MiB·2시간은 통과하고 그보다 1 이라도 크면 막는다.
 */
export const MEETING_UPLOAD_POLICY = {
  maxBytes: 200 * 1024 * 1024,
  maxDurationMs: 2 * 60 * 60 * 1000,
  /** MP3·WAV·M4A·OGG·WebM. 소문자로 비교한다 */
  extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm'],
} as const
