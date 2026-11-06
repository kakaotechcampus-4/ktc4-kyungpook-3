import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { toSubmitRejection } from './submitRejection'

function http(status: number, code: string, details: Record<string, unknown> | null = null) {
  return new ApiError({ code, message: 'raw', details }, status)
}

describe('toSubmitRejection', () => {
  it.each([
    [{ unknown_labels: ['SPEAKER_09'] }, { kind: 'labelsChanged' }],
    [{ missing_labels: ['SPEAKER_02'] }, { kind: 'labelsChanged' }],
    [{ missing_labels: ['SPEAKER_02'], member_ids: ['mb_04'] }, { kind: 'labelsChanged' }],
    [
      { member_ids: ['mb_04', 'mb_05'] },
      { kind: 'inactiveMembers', memberIds: ['mb_04', 'mb_05'] },
    ],
    [null, { kind: 'unknown' }],
  ])('400 details %j', (details, expected) => {
    expect(toSubmitRejection(http(400, 'INVALID_REQUEST', details))).toEqual(expected)
  })

  it('409 는 details.status 가 failed 일 때만 만료다', () => {
    const conflict = (status: unknown) =>
      toSubmitRejection(http(409, 'MEETING_NOT_AWAITING_SPEAKERS', { meeting_id: 'mt_11', status }))
    expect(conflict('failed')).toEqual({ kind: 'expired' })
    expect(conflict('processing')).toEqual({ kind: 'alreadyMoved', status: 'processing' })
    expect(conflict('done')).toEqual({ kind: 'alreadyMoved', status: 'done' })
    expect(conflict(undefined)).toEqual({ kind: 'unknown' })
    expect(toSubmitRejection(http(409, 'MEETING_ALREADY_ENDED'))).toEqual({ kind: 'unknown' })
  })

  it('권한·없음·연결 실패를 가른다', () => {
    expect(toSubmitRejection(http(403, 'FORBIDDEN'))).toEqual({ kind: 'forbidden' })
    expect(toSubmitRejection(http(404, 'MEETING_NOT_FOUND'))).toEqual({ kind: 'notFound' })
    expect(toSubmitRejection(createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR))).toEqual({
      kind: 'network',
    })
    expect(toSubmitRejection(http(500, 'INTERNAL_ERROR'))).toEqual({ kind: 'unknown' })
    expect(toSubmitRejection(new TypeError('boom'))).toEqual({ kind: 'unknown' })
  })
})
