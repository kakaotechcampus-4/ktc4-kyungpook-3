const MIB = 1024 * 1024

/** 녹음 길이. 한 시간 미만은 `52:14`, 넘으면 `1:02:03` (Upload 캔버스의 `52:14`) */
export function formatAudioDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** 파일 크기. 한도와 같은 MiB 단위로 소수 한 자리 — 1 MiB 미만은 `0.1 MiB` 부터 */
export function formatAudioSize(bytes: number): string {
  const mib = Math.max(bytes / MIB, bytes > 0 ? 0.1 : 0)
  return `${mib.toFixed(1)} MiB`
}
