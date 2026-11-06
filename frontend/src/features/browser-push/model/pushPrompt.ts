import type { PushState } from './useBrowserPush'

/**
 * 리마인드 대화 위 알림 띠가 그릴 것 (#411).
 * `offer` 는 켜자고 권한다, `install` 은 iOS 에서 홈 화면 앱으로 열라고 안내한다, `failed` 는 켜기에 실패해 다시 시도를 권한다
 */
export type PushPromptView =
  { kind: 'hidden' } | { kind: 'offer'; busy: boolean } | { kind: 'install' } | { kind: 'failed' }

export function pushPromptView(state: PushState): PushPromptView {
  switch (state.status) {
    case 'idle':
      return state.publicKey === null ? { kind: 'hidden' } : { kind: 'offer', busy: false }
    case 'subscribing':
      return { kind: 'offer', busy: true }
    case 'needs-install':
      return { kind: 'install' }
    case 'error':
      // 서버 키를 확인하지 못한 실패는 이 사람이 누른 일이 아니다 — 띠로 알리지 않는다
      return state.publicKey === null ? { kind: 'hidden' } : { kind: 'failed' }
    case 'unsupported':
    case 'no-server-key':
    case 'denied':
    case 'subscribed':
      return { kind: 'hidden' }
  }
}

/** 이 기기·계정에서 띠를 다시 볼 일이 없는 상태. 켜졌거나 브라우저가 알림을 막았다 */
export function settlesPushPrompt(state: PushState): boolean {
  return state.status === 'subscribed' || state.status === 'denied'
}
