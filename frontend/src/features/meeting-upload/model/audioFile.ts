import { MEETING_UPLOAD_POLICY } from '@/entities/meeting'

/** 고른 파일을 받지 않는 까닭. 순서대로 검사한다 — 앞의 것이 먼저 걸린다 */
export type AudioRejection =
  'multiple' | 'format' | 'empty' | 'too_large' | 'too_long' | 'unreadable'

/**
 * 안내 문구. 캔버스에 오류 문구가 없어 D-149 에 맞춰 이 기능에서 정한다.
 * 크기는 MiB 다 — 판정과 문구가 같은 단위여야 경계(정확히 200 MiB 는 통과)가 안내와 맞는다.
 */
export const AUDIO_REJECTION_MESSAGE: Record<AudioRejection, string> = {
  multiple: '파일은 한 번에 하나만 올릴 수 있어요.',
  format: 'MP3·WAV·M4A·OGG·WebM 파일만 올릴 수 있어요.',
  empty: '빈 파일이에요. 녹음이 담긴 파일을 골라 주세요.',
  too_large: '200 MiB 이하 파일만 올릴 수 있어요.',
  too_long: '2시간 이하 녹음만 올릴 수 있어요.',
  unreadable: '파일 길이를 읽지 못했어요. 녹음 파일 형식이 맞는지 확인해 주세요.',
}

/** 파일 입력의 `accept`. 선택 창에서 거르는 것은 편의일 뿐이고 판정은 아래 검사가 한다 */
export const AUDIO_ACCEPT = MEETING_UPLOAD_POLICY.extensions.map((ext) => `.${ext}`).join(',')

/** 검사에 쓰는 File 의 부분. 단위 테스트가 200 MiB 를 실제로 만들지 않도록 이름과 크기만 본다 */
export interface AudioFileLike {
  name: string
  size: number
}

export type AudioCheck<F extends AudioFileLike> =
  { ok: true; file: F } | { ok: false; reason: AudioRejection }

/** 마지막 점 뒤를 소문자로. 점이 없으면 '' */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * 끌어다 놓거나 고른 파일들을 검사한다. 하나도 없으면(선택 창 취소) null — 아무것도 바꾸지 않는다.
 * 길이는 여기서 보지 않는다 — 브라우저가 비동기로 읽는다(`readAudioDuration` → `checkAudioDuration`).
 * 근거: docs/impl-decision/2026-10-02-meeting-upload-policy.md
 */
export function checkAudioFiles<F extends AudioFileLike>(
  files: readonly F[],
): AudioCheck<F> | null {
  if (files.length === 0) return null
  if (files.length > 1) return { ok: false, reason: 'multiple' }
  const [file] = files
  const extensions: readonly string[] = MEETING_UPLOAD_POLICY.extensions
  if (!extensions.includes(fileExtension(file.name))) return { ok: false, reason: 'format' }
  if (file.size <= 0) return { ok: false, reason: 'empty' }
  if (file.size > MEETING_UPLOAD_POLICY.maxBytes) return { ok: false, reason: 'too_large' }
  return { ok: true, file }
}

/** 브라우저가 읽은 길이(ms)를 검사한다. 읽지 못했으면(null) 형식 확인 안내다. 정확히 2시간은 통과 */
export function checkAudioDuration(durationMs: number | null): AudioRejection | null {
  if (durationMs === null) return 'unreadable'
  return durationMs > MEETING_UPLOAD_POLICY.maxDurationMs ? 'too_long' : null
}
