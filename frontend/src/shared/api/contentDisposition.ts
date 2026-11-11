const EXTENDED_FILENAME = /(?:^|;)\s*filename\*\s*=\s*([^;]*)/i
const UTF8_VALUE = /^utf-8'[^']*'(.+)$/i
const PLAIN_FILENAME = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i

/**
 * `Content-Disposition` 의 파일 이름. 한글 이름은 `filename*` 에만 실리므로 그쪽을 먼저 본다 (RFC 6266).
 * `filename*` 를 풀 수 없으면 `filename` 으로, 둘 다 없으면 null 이다
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (header === null || header === undefined) return null
  return extendedFilename(header) ?? plainFilename(header)
}

function extendedFilename(header: string): string | null {
  const encoded = EXTENDED_FILENAME.exec(header)?.[1]?.trim()
  const value = encoded === undefined ? undefined : UTF8_VALUE.exec(encoded)?.[1]
  if (value === undefined) return null
  try {
    return nonEmpty(decodeURIComponent(value))
  } catch {
    return null
  }
}

function plainFilename(header: string): string | null {
  const match = PLAIN_FILENAME.exec(header)
  if (match === null) return null
  const quoted = match[1]
  return nonEmpty(quoted === undefined ? (match[2] ?? '') : quoted.replace(/\\(.)/g, '$1'))
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
