import { Button } from '@/shared/ui/button'
import { useBrowserPush } from '../model/useBrowserPush'
import type { PushState } from '../model/useBrowserPush'

function message(state: PushState): string {
  switch (state.status) {
    case 'unsupported':
      return '이 브라우저는 푸시 알림을 받을 수 없어요. 알림은 화면 위 종에서 확인해 주세요.'
    case 'needs-install':
      return 'iPhone·iPad 는 Safari 공유 메뉴에서 홈 화면에 추가한 앱으로 열어야 알림을 받을 수 있어요.'
    case 'no-server-key':
      return '아직 브라우저 알림을 보낼 수 없어요. 알림은 화면 위 종에서 확인해 주세요.'
    case 'idle':
      return state.publicKey === null
        ? '이 기기에서 알림을 받을 수 있는지 확인하고 있어요.'
        : '켜면 이 브라우저를 닫아도 새 알림을 받아요.'
    case 'denied':
      return '알림이 막혀 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.'
    case 'subscribing':
      return '브라우저 알림을 켜고 있어요.'
    case 'subscribed':
      return '이 기기에서 브라우저 알림을 받고 있어요.'
    case 'error':
      return state.publicKey === null
        ? '브라우저 알림 상태를 확인하지 못했어요. 다시 시도해 주세요.'
        : '브라우저 알림을 켜지 못했어요. 다시 시도해 주세요.'
  }
}

function action(state: PushState): string | null {
  if (state.status === 'error') return '다시 시도'
  if (state.status === 'idle' || state.status === 'subscribing') return '브라우저 알림 켜기'
  return null
}

/** 설정의 알림 절에 두는 이 기기의 브라우저 푸시. 버튼을 누른 뒤에만 알림 허용을 묻는다 */
export function BrowserPushControl({ className }: { className?: string }) {
  const { state, enable } = useBrowserPush()
  const label = action(state)
  return (
    <div className={className}>
      <div className="flex-1">
        <span className="block text-body font-semibold text-ink">이 기기의 브라우저 알림</span>
        <span
          role={state.status === 'error' ? 'alert' : 'status'}
          className="block text-caption text-dim"
        >
          {message(state)}
        </span>
      </div>
      {label === null ? null : (
        <Button
          size="sm"
          loading={state.status === 'subscribing'}
          disabled={state.status === 'idle' && state.publicKey === null}
          onClick={enable}
        >
          {label}
        </Button>
      )}
    </div>
  )
}
