import { ApiError, createClientError } from '@/shared/api/errors'
import { formatAudioDuration, formatAudioSize } from '../lib/formatAudio'
import { classifyUploadError } from './uploadOutcome'
import { toUploadPhase } from './uploadPhase'
import { meetingUploadSchema, UPLOAD_FORM_MESSAGES } from './uploadSchema'

function http(code: string, status: number, details: Record<string, unknown> | null = null) {
  return new ApiError({ code, message: code, details }, status)
}

describe('전송 단계 (U3-7)', () => {
  it('전체 크기를 알면 내림한 백분율이다 — 99.6% 를 100% 로 올리지 않는다', () => {
    expect(toUploadPhase({ loaded: 0, total: 1000 })).toEqual({ kind: 'sending', percent: 0 })
    expect(toUploadPhase({ loaded: 425, total: 1000 })).toEqual({ kind: 'sending', percent: 42 })
    expect(toUploadPhase({ loaded: 996, total: 1000 })).toEqual({ kind: 'sending', percent: 99 })
  })

  it('다 보낸 것은 완료가 아니라 서버를 기다리는 단계다', () => {
    expect(toUploadPhase({ loaded: 1000, total: 1000 })).toEqual({ kind: 'waiting' })
  })

  it('전체 크기를 모르면 불확정이다 — 0% 와 구분한다', () => {
    expect(toUploadPhase({ loaded: 4096, total: null })).toEqual({
      kind: 'sending',
      percent: null,
    })
    expect(toUploadPhase(null)).toEqual({ kind: 'sending', percent: null })
  })
})

describe('업로드 실패 분류 (U3-8, U3-10)', () => {
  it('409 정리 중 + details.meeting_id 는 그 처리 화면이다', () => {
    expect(
      classifyUploadError(http('MEETING_PROCESSING_IN_PROGRESS', 409, { meeting_id: 'mt_10' })),
    ).toEqual({ kind: 'processing', meetingId: 'mt_10' })
  })

  it('409 정리 중인데 회의 ID 가 없으면 폼에 알린다', () => {
    expect(classifyUploadError(http('MEETING_PROCESSING_IN_PROGRESS', 409))).toEqual({
      kind: 'form',
      message: '이미 정리 중인 회의가 있어요.',
    })
  })

  it.each([
    ['INTEGRATION_NOT_CONNECTED', 'not_connected'],
    ['INTEGRATION_REVOKED', 'revoked'],
  ])('%s 는 차단 흐름(%s)이다', (code, reason) => {
    expect(classifyUploadError(http(code, 409))).toEqual({ kind: 'blocked', reason })
  })

  it('413 은 파일 칸에 화면 한도와 같은 문구로 알린다', () => {
    expect(classifyUploadError(http('AUDIO_TOO_LARGE', 413))).toEqual({
      kind: 'file',
      message: '200 MiB 이하 파일만 올릴 수 있어요.',
    })
  })

  it('400 검증 오류는 폼 상단에 알린다', () => {
    expect(classifyUploadError(http('INVALID_REQUEST', 400))).toEqual({
      kind: 'form',
      message: '요청 내용을 다시 확인해 주세요.',
    })
  })

  it('401 은 화면이 처리하지 않는다 — 앱의 세션 만료가 맡는다', () => {
    expect(classifyUploadError(http('UNAUTHENTICATED', 401))).toEqual({ kind: 'session' })
  })

  it('응답을 받지 못한 것은 「잃음」이다 — 실패로 단정하지 않는다', () => {
    expect(classifyUploadError(createClientError('NETWORK_ERROR'))).toEqual({ kind: 'lost' })
  })

  it('취소는 무시한다', () => {
    expect(classifyUploadError(createClientError('REQUEST_CANCELED'))).toEqual({
      kind: 'ignored',
    })
  })
})

describe('폼 검증 (U3-6)', () => {
  const valid = { title: '3주차 정기회의.m4a', date: '2026-09-09', attendeeMemberIds: ['mb_01'] }

  it('제목·날짜·참석자 1명 이상이면 통과하고 제목 앞뒤 공백을 지운다', () => {
    expect(meetingUploadSchema.parse({ ...valid, title: '  회의  ' })).toEqual({
      ...valid,
      title: '회의',
    })
  })

  it.each(['', '   ', '\t\n'])('공백뿐인 제목 %j 는 막는다', (title) => {
    const result = meetingUploadSchema.safeParse({ ...valid, title })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(({ message }) => message)).toEqual([
      UPLOAD_FORM_MESSAGES.titleRequired,
    ])
  })

  it('참석자 0명은 막는다', () => {
    const result = meetingUploadSchema.safeParse({ ...valid, attendeeMemberIds: [] })
    expect(result.error?.issues.map(({ message }) => message)).toEqual([
      UPLOAD_FORM_MESSAGES.attendeesRequired,
    ])
  })

  it.each(['', '2026-02-30', '2026/09/09'])('날짜 %j 는 막는다', (date) => {
    expect(meetingUploadSchema.safeParse({ ...valid, date }).success).toBe(false)
  })
})

describe('파일 표시', () => {
  it('길이는 캔버스처럼 분:초, 한 시간이 넘으면 시:분:초', () => {
    expect(formatAudioDuration(52 * 60_000 + 14_000)).toBe('52:14')
    expect(formatAudioDuration(3_723_000)).toBe('1:02:03')
    expect(formatAudioDuration(4_000)).toBe('00:04')
  })

  it('크기는 한도와 같은 MiB 다', () => {
    expect(formatAudioSize(48.2 * 1024 * 1024)).toBe('48.2 MiB')
    expect(formatAudioSize(200 * 1024 * 1024)).toBe('200.0 MiB')
    expect(formatAudioSize(10)).toBe('0.1 MiB')
  })
})
