import { readAudioDuration } from './audioDuration'
import type { AudioDurationEnv, DurationProbe } from './audioDuration'

/** jsdom 은 미디어를 읽지 못한다. 메타데이터 이벤트를 테스트가 직접 쏘는 가짜 오디오 요소 */
class FakeProbe extends EventTarget implements DurationProbe {
  preload = ''
  src = ''
  duration = Number.NaN
  currentTime = 0
  loads = 0
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  load() {
    this.loads += 1
  }
  emit(type: string, duration?: number) {
    if (duration !== undefined) this.duration = duration
    this.dispatchEvent(new Event(type))
  }
}

function setup(timeoutMs = 1_000) {
  const probe = new FakeProbe()
  const created: string[] = []
  const revoked: string[] = []
  const env: AudioDurationEnv = {
    createObjectURL: () => {
      const url = `blob:test/${created.length + 1}`
      created.push(url)
      return url
    },
    revokeObjectURL: (url) => revoked.push(url),
    createProbe: () => probe,
    timeoutMs,
  }
  const file = new Blob(['audio'], { type: 'audio/mpeg' })
  return { probe, created, revoked, env, file }
}

describe('녹음 길이 읽기와 object URL 해제 (U3-4)', () => {
  it('메타데이터의 길이를 ms 로 돌려주고 URL 을 해제한다', async () => {
    const { probe, created, revoked, env, file } = setup()
    const pending = readAudioDuration(file, env)
    expect(probe.preload).toBe('metadata')
    expect(probe.src).toBe('blob:test/1')
    probe.emit('loadedmetadata', 3134.4)

    await expect(pending).resolves.toBe(3_134_400)
    expect(revoked).toEqual(created)
    // 요소가 파일을 붙잡지 않게 출처를 비웠다
    expect(probe.src).toBe('')
    expect(probe.loads).toBe(1)
  })

  it('읽지 못하면(error) null 이고 URL 은 해제한다', async () => {
    const { probe, created, revoked, env, file } = setup()
    const pending = readAudioDuration(file, env)
    probe.emit('error')
    await expect(pending).resolves.toBeNull()
    expect(revoked).toEqual(created)
  })

  it.each([Number.NaN, 0])('길이가 %s 면 읽지 못한 것이다 — URL 은 해제한다', async (duration) => {
    const { probe, created, revoked, env, file } = setup()
    const pending = readAudioDuration(file, env)
    probe.emit('loadedmetadata', duration)
    await expect(pending).resolves.toBeNull()
    expect(revoked).toEqual(created)
  })

  it('메타데이터가 오지 않으면 시간 한도에서 null 이고 URL 은 해제한다', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { created, revoked, env, file } = setup(500)
    const pending = readAudioDuration(file, env)
    vi.advanceTimersByTime(499)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1)
    await expect(pending).resolves.toBeNull()
    expect(revoked).toEqual(created)
  })

  it('길이가 Infinity 면(MediaRecorder WebM) 끝으로 감아 실제 길이를 받는다', async () => {
    const { probe, revoked, env, file } = setup()
    const pending = readAudioDuration(file, env)
    probe.emit('loadedmetadata', Number.POSITIVE_INFINITY)
    expect(probe.currentTime).toBe(Number.MAX_SAFE_INTEGER)
    expect(revoked).toEqual([])
    probe.emit('durationchange', 61.2)
    await expect(pending).resolves.toBe(61_200)
    expect(revoked).toHaveLength(1)
  })

  it('끝난 뒤의 이벤트는 무시한다 — URL 은 한 번만 해제한다', async () => {
    const { probe, revoked, env, file } = setup()
    const pending = readAudioDuration(file, env)
    probe.emit('loadedmetadata', 10)
    await pending
    probe.emit('error')
    probe.emit('loadedmetadata', 20)
    expect(revoked).toHaveLength(1)
  })
})
