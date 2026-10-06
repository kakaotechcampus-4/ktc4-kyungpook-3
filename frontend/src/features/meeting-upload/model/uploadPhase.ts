import type { UploadProgress } from '@/shared/api/client'

/**
 * 제출 뒤 화면이 보여 줄 단계. 전송률과 서버 단계를 나눈다 (U3-7).
 * - `sending`: 보내는 중. 전체 크기를 알면 백분율, 모르면 불확정(`percent: null`)
 * - `waiting`: 다 보냈다. 서버가 받아 정리를 시작했다는 202 를 기다린다 — 100% 여도 끝이 아니다
 */
export type UploadPhase = { kind: 'sending'; percent: number | null } | { kind: 'waiting' }

export function toUploadPhase(progress: UploadProgress | null): UploadPhase {
  if (progress === null || progress.total === null) return { kind: 'sending', percent: null }
  const { loaded, total } = progress
  if (loaded >= total) return { kind: 'waiting' }
  // 99.6% 를 100% 로 올려 「다 보냈다」처럼 보이지 않게 내림한다
  return { kind: 'sending', percent: Math.floor((loaded / total) * 100) }
}
