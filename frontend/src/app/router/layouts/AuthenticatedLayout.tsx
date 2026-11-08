import { Outlet } from 'react-router'
import { useSyncPushSubscription } from '@/features/browser-push'
import { useProcessingTracker } from '@/features/meeting-processing'

/**
 * 로그인한 사용자의 화면 전체를 감싼다. 회의 정리 추적기를 여기 하나 둔다 —
 * 화면·워크스페이스를 옮겨도 polling 이 끊기지 않고, 로그아웃하면 이 칸이 내려가며 함께 멈춘다 (U4-1, U4-3).
 * 로그인 세션마다 이 기기의 기존 푸시 구독을 지금 계정으로 옮긴다 — 어느 화면을 열든, 알림 띠를 닫았든 맞춘다 (#411).
 */
export function AuthenticatedLayout() {
  useSyncPushSubscription()
  useProcessingTracker()
  return <Outlet />
}
