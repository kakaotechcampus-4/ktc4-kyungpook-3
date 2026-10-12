/** 메타데이터를 기다리는 한도. 넘으면 길이를 읽지 못한 것으로 본다 */
export const DURATION_READ_TIMEOUT_MS = 15_000

/** 길이를 읽는 데 쓰는 오디오 요소의 부분. 테스트가 가짜 요소를 넣는다 — jsdom 은 미디어를 읽지 못한다 */
export interface DurationProbe extends EventTarget {
  preload: string
  src: string
  readonly duration: number
  currentTime: number
  removeAttribute: (name: string) => void
  load: () => void
}

export interface AudioDurationEnv {
  createObjectURL: (file: Blob) => string
  revokeObjectURL: (url: string) => void
  createProbe: () => DurationProbe
  timeoutMs?: number
}

const browserEnv: AudioDurationEnv = {
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createProbe: () => document.createElement('audio'),
}

/**
 * 브라우저가 파일의 길이를 읽는다(ms). 읽지 못하면 null — 형식 확인 안내와 함께 제출을 막는다 (계획 §3).
 * 서버가 길이를 모르므로 이 검사가 2시간 한도의 유일한 판정이다.
 *
 * 메타데이터용 object URL 은 성공·실패·시간 초과 어느 쪽이든 끝나는 순간 해제한다.
 * MediaRecorder 로 만든 WebM 은 길이가 Infinity 로 오는 일이 있다 — 끝으로 한 번 감아 실제 길이를 받는다.
 */
export function readAudioDuration(
  file: Blob,
  env: AudioDurationEnv = browserEnv,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = env.createObjectURL(file)
    const probe = env.createProbe()
    let settled = false
    let seekedToEnd = false

    const finish = (durationMs: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      probe.removeEventListener('loadedmetadata', onMetadata)
      probe.removeEventListener('durationchange', onDurationChange)
      probe.removeEventListener('error', onError)
      // 요소가 파일을 계속 붙잡지 않게 출처를 비운다
      probe.removeAttribute('src')
      probe.load()
      env.revokeObjectURL(url)
      resolve(durationMs)
    }

    const readFinite = (): boolean => {
      const seconds = probe.duration
      if (!Number.isFinite(seconds) || seconds <= 0) return false
      finish(Math.round(seconds * 1000))
      return true
    }

    function onMetadata() {
      if (readFinite()) return
      if (probe.duration === Number.POSITIVE_INFINITY && !seekedToEnd) {
        seekedToEnd = true
        probe.currentTime = Number.MAX_SAFE_INTEGER
        return
      }
      finish(null)
    }

    function onDurationChange() {
      if (seekedToEnd) readFinite()
    }

    function onError() {
      finish(null)
    }

    const timer = setTimeout(() => finish(null), env.timeoutMs ?? DURATION_READ_TIMEOUT_MS)
    probe.addEventListener('loadedmetadata', onMetadata)
    probe.addEventListener('durationchange', onDurationChange)
    probe.addEventListener('error', onError)
    probe.preload = 'metadata'
    probe.src = url
  })
}
