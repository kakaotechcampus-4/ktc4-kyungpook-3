import type { MinutesDto } from '@/shared/types/api/minutes'
import { fetchDto } from '@/shared/test/api'
import { completeMeeting, failMeeting } from './meetingFlow'
import { MOCK_RECORDING_SECONDS } from './meetingAudio'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'
import { silentWavSize } from './speakerAudio'

const audioUrl = (meetingId: string) =>
  new URL(`/api/v1/meetings/${meetingId}/audio`, window.location.origin)

async function failure(meetingId: string) {
  const response = await fetch(audioUrl(meetingId))
  const body = (await response.json()) as { error: { code: string; details: unknown } }
  return { status: response.status, code: body.error.code, details: body.error.details }
}

describe('회의 녹음 재생 MSW (계약 §2.3.1, #676)', () => {
  it('들을 수 있는 done 회의는 S3 임시 주소로 302 하고, 그 주소는 Range 에 206 으로 답한다', async () => {
    const redirect = await fetch(audioUrl('mt_09'), { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('cache-control')).toBe('private, no-store')
    const location = new URL(redirect.headers.get('location') ?? '', window.location.origin)

    const part = await fetch(location, { headers: { Range: 'bytes=0-3' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(
      `bytes 0-3/${silentWavSize(MOCK_RECORDING_SECONDS)}`,
    )
    expect(new TextDecoder().decode(await part.arrayBuffer())).toBe('RIFF')
  })

  it('done 회의는 일반 팀원도 듣고, 회의록 audio 도 받는다', async () => {
    setMockRole('member')
    expect((await fetch(audioUrl('mt_09'), { redirect: 'manual' })).status).toBe(302)
    const minutes = await fetchDto<MinutesDto>('/meetings/mt_09/minutes')
    expect(minutes.audio).toMatchObject({ content_type: 'audio/wav' })
  })

  it('보관 기간이 지난 회의는 404 expired, 채팅 회의는 404 no_recording 이다', async () => {
    await expect(failure('mt_07')).resolves.toEqual({
      status: 404,
      code: 'AUDIO_NOT_AVAILABLE',
      details: { meeting_id: 'mt_07', reason: 'expired' },
    })
    await expect(failure('mt_08')).resolves.toMatchObject({
      status: 404,
      code: 'AUDIO_NOT_AVAILABLE',
      details: { reason: 'no_recording' },
    })
  })

  it('meeting-audio-expired 시나리오는 mt_09 의 녹음이 회의록에도 재생에도 없다', async () => {
    applyScenario('meeting-audio-expired')
    expect((await fetchDto<MinutesDto>('/meetings/mt_09/minutes')).audio).toBeNull()
    await expect(failure('mt_09')).resolves.toMatchObject({
      status: 404,
      details: { reason: 'expired' },
    })
  })

  it('처리 중 회의는 PM 만 듣는다. 일반 팀원은 403 FORBIDDEN 이다', async () => {
    expect((await fetch(audioUrl('mt_10'), { redirect: 'manual' })).status).toBe(302)
    setMockRole('member')
    await expect(failure('mt_10')).resolves.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('정리를 끝낸 업로드 회의는 보관 기간 동안 녹음이 남는다', async () => {
    completeMeeting('mt_10')
    expect((await fetch(audioUrl('mt_10'), { redirect: 'manual' })).status).toBe(302)
    expect((await fetchDto<MinutesDto>('/meetings/mt_10/minutes')).audio).not.toBeNull()
  })

  it('실패한 회의는 녹음이 없다', async () => {
    failMeeting('mt_10')
    await expect(failure('mt_10')).resolves.toMatchObject({
      status: 404,
      details: { reason: 'no_recording' },
    })
  })

  it('없는 회의는 404 MEETING_NOT_FOUND 다', async () => {
    await expect(failure('mt_404')).resolves.toMatchObject({
      status: 404,
      code: 'MEETING_NOT_FOUND',
    })
  })
})
