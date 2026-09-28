import {
  cancelLeave,
  confirmLeave,
  useBrowserLeaveGuard,
  useUnsavedChangesStore,
} from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

/* 공통 확인 문구 (D-138, D-149). 모달이 앱에 하나라 문구도 여기 하나다 */
const COPY = {
  title: '저장하지 않은 변경 내용이 있어요',
  description: '지금 나가면 작성한 내용이 사라져요.',
  stay: '계속 작성하기',
  leave: '변경 내용 버리고 나가기',
} as const

/**
 * 앱에 하나만 올린다. 등록이 여럿이어도 모달은 하나다.
 * - 앱 안 링크·코드 이동·워크스페이스 이동: GuardedLink·useGuardedNavigate 가 이동을 저장해 두면 열린다
 * - 뒤로가기·앞으로가기: useBrowserLeaveGuard 가 popstate 에서 제자리로 돌린 뒤 같은 방법으로 연다
 * - 새로고침·탭 닫기: useBrowserLeaveGuard 의 beforeunload — 브라우저 기본 경고
 * `계속 작성하기`·Esc·배경 클릭은 저장해 둔 이동을 버리고, `변경 내용 버리고 나가기`는 그 이동을 실행한다.
 * 첫 포커스는 `계속 작성하기`다 — 실수로 Enter 를 눌러도 내용을 잃지 않는다.
 */
export function UnsavedChangesPrompt() {
  useBrowserLeaveGuard()
  const open = useUnsavedChangesStore((state) => state.pendingLeave !== null)

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelLeave()
      }}
      title={COPY.title}
      description={COPY.description}
      actions={
        <>
          <Button variant="ghost" onClick={cancelLeave}>
            {COPY.stay}
          </Button>
          <Button variant="primary" onClick={confirmLeave}>
            {COPY.leave}
          </Button>
        </>
      }
    />
  )
}
