import { useCallback, useEffect, useState } from 'react'
import {
  fetchPushPublicKey,
  findPushSubscription,
  savePushSubscription,
} from '@/entities/notification'
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

async function serverState(): Promise<PushState> {
  const [publicKey, subscription] = await Promise.all([
    fetchPushPublicKey(),
    findPushSubscription(),
  ])
  if (publicKey === null) return { status: 'no-server-key' }
  if (subscription && Notification.permission === 'granted') return { status: 'subscribed' }
  return { status: 'idle', publicKey }
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
    void (async () => {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setState(permission === 'denied' ? { status: 'denied' } : { status: 'idle', publicKey })
          return
        }
        const registration = await registerPushWorker()
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(publicKey),
          }))
        await savePushSubscription(subscription)
        setState({ status: 'subscribed' })
      } catch {
        setState({ status: 'error', publicKey })
      }
    })()
  }, [state])

  return { state, enable }
}
