import { useCallback, useEffect, useState } from 'react'
import {
  fetchPushPublicKey,
  findPushSubscription,
  savePushSubscription,
  trackPushSubscribing,
} from '@/entities/notification'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { applicationServerKey, registerPushWorker } from '../lib/pushWorker'

/**
 * 이 기기의 브라우저 푸시. 화면은 이 상태만 보고 그린다.
 * `idle`·`error` 의 공개키가 null 이면 아직 서버 키를 모른다 — `idle` 은 확인하는 중, `error` 는 확인에 실패했다
 */
export type PushState =
  | {
      status:
        'unsupported' | 'needs-install' | 'no-server-key' | 'denied' | 'subscribing' | 'subscribed'
    }
  | { status: 'idle' | 'error'; publicKey: string | null }

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 는 데스크톱 Safari 로 자신을 알린다
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  )
}

/** 서버에 묻지 않고 알 수 있는 상태. 묻기 전에는 `idle` 이다 */
function environmentState(): PushState {
  // iOS 는 홈 화면에 추가한 앱에서만 푸시를 받는다. 그 밖에서는 PushManager 가 없어 먼저 가른다
  if (isIos() && !isStandalone()) return { status: 'needs-install' }
  if (
    !('serviceWorker' in navigator) ||
    typeof PushManager === 'undefined' ||
    typeof Notification === 'undefined'
  )
    return { status: 'unsupported' }
  if (Notification.permission === 'denied') return { status: 'denied' }
  return { status: 'idle', publicKey: null }
}

/**
 * 서버에 물어 정하는 상태. 허용돼 있고 브라우저 구독이 있으면 지금 계정으로 다시 등록한 뒤에 `subscribed` 다 —
 * 브라우저 구독만 보고 켜졌다고 하면, 서버 등록이 실패했던 기기가 다시 열 때 켜진 것처럼 보이고 다시 시도할 길이 없다 (#330 검증 2).
 * 같은 endpoint 를 다시 보내면 지금 계정으로 옮기므로 열 때마다 보내도 된다. 재등록이 실패하면 `error` 라 다시 시도할 수 있다
 */
function serverState(): Promise<PushState> {
  const session = captureSessionScope()
  return trackPushSubscribing(async (): Promise<PushState> => {
    const [publicKey, subscription] = await Promise.all([
      fetchPushPublicKey(),
      findPushSubscription(),
    ])
    if (publicKey === null) return { status: 'no-server-key' }
    if (!subscription || Notification.permission !== 'granted') return { status: 'idle', publicKey }
    try {
      const saved = await savePushSubscription(subscription, session)
      return saved ? { status: 'subscribed' } : { status: 'idle', publicKey }
    } catch {
      return { status: 'error', publicKey }
    }
  })
}

export interface BrowserPush {
  state: PushState
  /** 버튼을 눌렀을 때만 부른다. 알림 허용은 여기서만 묻는다 */
  enable: () => void
}

export function useBrowserPush(): BrowserPush {
  const [state, setState] = useState<PushState>(environmentState)
  const checking = state.status === 'idle' && state.publicKey === null

  // 공개키는 화면을 열 때 미리 받는다. 누른 뒤에 받으면 iOS 가 권한 요청을 사용자 동작 밖으로 보고 막는다
  useEffect(() => {
    if (!checking) return
    let active = true
    serverState().then(
      (next) => {
        if (active) setState(next)
      },
      () => {
        if (active) setState({ status: 'error', publicKey: null })
      },
    )
    return () => {
      active = false
    }
  }, [checking])

  const enable = useCallback(() => {
    if (state.status !== 'idle' && state.status !== 'error') return
    const { publicKey } = state
    if (publicKey === null) {
      setState({ status: 'idle', publicKey: null })
      return
    }
    setState({ status: 'subscribing' })
    // 시작한 세션을 잡아 둔다. 끝나기 전에 세션이 바뀌면 서버에 보내지 않거나 보낸 요청을 취소하고 브라우저 구독을 푼다
    const session = captureSessionScope()
    void trackPushSubscribing(async (): Promise<PushState> => {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted')
        return permission === 'denied' ? { status: 'denied' } : { status: 'idle', publicKey }
      const registration = await registerPushWorker()
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }))
      const saved = await savePushSubscription(subscription, session)
      return saved ? { status: 'subscribed' } : { status: 'idle', publicKey }
    }).then(setState, () => setState({ status: 'error', publicKey }))
  }, [state])

  return { state, enable }
}
