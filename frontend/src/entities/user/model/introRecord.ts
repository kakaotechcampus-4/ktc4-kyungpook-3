import type { QueryClient } from '@tanstack/react-query'
import { sessionQueryOptions } from '../api/session'
import { captureSession } from './sessionGeneration'

/*
 * 첫 방문 인트로를 본 기록 (#430). 이 기기의 localStorage 에 둔다.
 * - 기기: 랜딩의 로그인·가입 버튼을 처음 누를 때의 인트로. 값이 있으면 봤다
 * - 계정: 온보딩을 마친 뒤 첫 대시보드의 인트로. 이 브라우저가 온보딩 완료를 본 계정만 `pending` 이 되고, 닫으면 `seen` 이다.
 *   이미 쓰던 계정이 그냥 로그인하거나 다른 기기에서 열면 기록이 없어 보이지 않는다
 * 막힌 저장소(사생활 모드 등)에서 읽지 못하면 기기 인트로는 보이고(본 기록이 없다) 계정 인트로는 보이지 않는다(받은 신호가 없다).
 * 쓰지 못해도 인트로는 닫힌다
 */

const DEVICE_KEY = 'first-visit-intro:device'
const accountKey = (userId: string) => `first-visit-intro:account:${userId}`

type AccountIntroState = 'pending' | 'seen'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 기록하지 못해도 지금 인트로는 닫는다
  }
}

export function isDeviceIntroSeen(): boolean {
  return read(DEVICE_KEY) !== null
}

export function markDeviceIntroSeen(): void {
  write(DEVICE_KEY, 'seen')
}

export interface AccountIntro {
  /** 온보딩 완료 신호를 받았고 아직 닫지 않았다 */
  isDue: () => boolean
  /** 온보딩 완료 신호. 이미 닫았으면 그대로 둔다 */
  markPending: () => void
  markSeen: () => void
}

/**
 * 지금 세션 계정의 인트로 기록. 비로그인이면 null 이다.
 * 부른 순간의 세션에 묶인다 — 그 뒤 로그아웃·계정 전환이 있으면 쓰지 않는다. 이전 계정의 키에 남지 않게 신호를 받을 때와
 * 인트로를 열 때 부른다
 */
export function captureAccountIntro(queryClient: QueryClient): AccountIntro | null {
  const session = queryClient.getQueryData(sessionQueryOptions().queryKey)
  if (!session) return null
  const isCurrent = captureSession()
  const key = accountKey(session.user.id)
  const state = (): AccountIntroState | null => {
    const value = read(key)
    return value === 'pending' || value === 'seen' ? value : null
  }
  return {
    isDue: () => state() === 'pending',
    markPending: () => {
      if (isCurrent() && state() !== 'seen') write(key, 'pending')
    },
    markSeen: () => {
      if (isCurrent()) write(key, 'seen')
    },
  }
}
