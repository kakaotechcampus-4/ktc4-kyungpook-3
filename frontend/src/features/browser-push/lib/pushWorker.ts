import workerUrl from '../worker/pushWorker?worker&url'

/**
 * 푸시 워커의 범위는 워커 파일이 있는 폴더다(빌드 `/push/`, 개발 `/src/.../worker/`). 개발 중 MSW 는 `/` 에 등록한다 —
 * 범위가 겹치지 않아 두 등록이 서로를 덮지 않고, 푸시 워커는 페이지를 관리하지 않는다
 */
const workerHref = new URL(workerUrl, window.location.href).href
const scope = new URL('.', workerHref).href

/**
 * 푸시 워커를 등록하고 활성화를 기다린다. `navigator.serviceWorker.ready` 는 페이지를 관리하는 등록(개발 중 MSW)을
 * 돌려주므로 쓰지 않는다. 빌드는 iife 번들이라 classic, 개발 서버는 ES 모듈로 내보낸다
 */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(workerHref, {
    scope,
    type: import.meta.env.DEV ? 'module' : 'classic',
  })
  const worker = registration.installing ?? registration.waiting
  if (registration.active || !worker) return registration
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (worker.state === 'activated') resolve()
      else if (worker.state === 'redundant') reject(new Error('push worker install failed'))
      else return
      worker.removeEventListener('statechange', check)
    }
    worker.addEventListener('statechange', check)
    check()
  })
  return registration
}

/** base64url 공개키를 `pushManager.subscribe` 가 받는 바이트로 바꾼다 */
export function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}
