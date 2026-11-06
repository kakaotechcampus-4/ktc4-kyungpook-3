const SAMPLE_RATE = 8_000
const BYTES_PER_SAMPLE = 2
const HEADER_BYTES = 44

function dataBytesOf(seconds: number): number {
  return Math.ceil(seconds * SAMPLE_RATE) * BYTES_PER_SAMPLE
}

export function silentWavSize(seconds: number): number {
  return HEADER_BYTES + dataBytesOf(seconds)
}

export function silentWav(seconds: number): Uint8Array {
  const dataBytes = dataBytesOf(seconds)
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes
}

/**
 * `Range: bytes=a-b` 를 읽는다. 맞지 않거나 범위 밖이면 null 이다 — 그때는 전체를 준다.
 * 브라우저는 `<audio>` 를 옮길 때 `bytes=n-` 으로 묻는다
 */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  const match = header === null ? null : /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return start <= end ? { start, end } : null
}
