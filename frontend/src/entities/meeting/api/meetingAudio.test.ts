import { http } from 'msw'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { probeMeetingAudio, toAudioProbe } from './meetingAudio'

const envelope = (code: string, details: Record<string, unknown> | null) =>
  JSON.stringify({ data: null, error: { code, message: 'x', details } })

describe('toAudioProbe', () => {
  it('브라우저가 따라가지 않은 302(opaqueredirect)와 2xx 는 녹음이 있다는 뜻이다', () => {
    expect(toAudioProbe({ type: 'opaqueredirect', status: 0 }, null)).toEqual({
      kind: 'reachable',
    })
    expect(toAudioProbe({ type: 'basic', status: 302 }, null)).toEqual({ kind: 'reachable' })
    expect(toAudioProbe({ type: 'basic', status: 206 }, null)).toEqual({ kind: 'reachable' })
  })

  it('AUDIO_NOT_AVAILABLE 은 이유를 읽고, 모르는 이유는 null 이다', () => {
    const notAvailable = (reason: unknown) =>
      toAudioProbe(
        { type: 'basic', status: 404 },
        envelope('AUDIO_NOT_AVAILABLE', { meeting_id: 'mt_09', reason }),
      )
    expect(notAvailable('expired')).toEqual({ kind: 'unavailable', reason: 'expired' })
    expect(notAvailable('no_recording')).toEqual({ kind: 'unavailable', reason: 'no_recording' })
    expect(notAvailable('purged')).toEqual({ kind: 'unavailable', reason: null })
  })

  it('다른 404·권한·삭제·서버 오류는 확인 실패다', () => {
    expect(
      toAudioProbe({ type: 'basic', status: 404 }, envelope('MEETING_NOT_FOUND', null)),
    ).toEqual({ kind: 'failed' })
    expect(toAudioProbe({ type: 'basic', status: 404 }, '<html>')).toEqual({ kind: 'failed' })
    for (const status of [401, 403, 410, 500])
      expect(toAudioProbe({ type: 'basic', status }, envelope('X', null))).toEqual({
        kind: 'failed',
      })
  })
})

describe('probeMeetingAudio (MSW)', () => {
  it('들을 수 있는 회의는 302 를 따라가지 않고 reachable 이다', async () => {
    const s3 = vi.fn()
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/__mock/s3/')) s3()
    })
    await expect(probeMeetingAudio('mt_09')).resolves.toEqual({ kind: 'reachable' })
    expect(s3).not.toHaveBeenCalled()
    server.events.removeAllListeners()
  })

  it('보관 기간이 지난 회의는 expired 다', async () => {
    applyScenario('meeting-audio-expired')
    await expect(probeMeetingAudio('mt_09')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'expired',
    })
  })

  it('보낼 수 없으면 던지지 않고 failed 다', async () => {
    server.use(http.get('/api/v1/meetings/:meetingId/audio', () => Response.error()))
    await expect(probeMeetingAudio('mt_09')).resolves.toEqual({ kind: 'failed' })
    server.use(http.get('/api/v1/meetings/:meetingId/audio', () => fail('FORBIDDEN', 'x', 403)))
    await expect(probeMeetingAudio('mt_09')).resolves.toEqual({ kind: 'failed' })
  })
})
