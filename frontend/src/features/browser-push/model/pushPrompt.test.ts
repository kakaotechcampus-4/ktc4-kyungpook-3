import { pushPromptView, settlesPushPrompt } from './pushPrompt'
import type { PushPromptView } from './pushPrompt'
import type { PushState } from './useBrowserPush'

const KEY = 'AQID'

const TABLE: [string, PushState, PushPromptView, boolean][] = [
  ['서버 키를 확인하는 중', { status: 'idle', publicKey: null }, { kind: 'hidden' }, false],
  ['켤 수 있다', { status: 'idle', publicKey: KEY }, { kind: 'offer', busy: false }, false],
  ['켜는 중', { status: 'subscribing' }, { kind: 'offer', busy: true }, false],
  ['iOS 홈 화면 앱이 아니다', { status: 'needs-install' }, { kind: 'install' }, false],
  ['켜기에 실패했다', { status: 'error', publicKey: KEY }, { kind: 'failed' }, false],
  ['서버 키 확인에 실패했다', { status: 'error', publicKey: null }, { kind: 'hidden' }, false],
  ['지원하지 않는 브라우저', { status: 'unsupported' }, { kind: 'hidden' }, false],
  ['서버에 키가 없다', { status: 'no-server-key' }, { kind: 'hidden' }, false],
  ['브라우저가 알림을 막았다', { status: 'denied' }, { kind: 'hidden' }, true],
  ['이미 켜져 있다', { status: 'subscribed' }, { kind: 'hidden' }, true],
]

describe('리마인드 대화 위 알림 띠 (#411)', () => {
  it.each(TABLE)('%s', (_, state, view, settles) => {
    expect(pushPromptView(state)).toEqual(view)
    expect(settlesPushPrompt(state)).toBe(settles)
  })
})
