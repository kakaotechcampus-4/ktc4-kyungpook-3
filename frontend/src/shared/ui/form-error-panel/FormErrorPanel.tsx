import type { ReactNode } from 'react'
import { Panel } from '../panel/Panel'

export interface FormErrorPanelProps {
  /** 문구는 호출자가 준다. 없으면 아무것도 그리지 않는다 */
  message: string | null | undefined
  /** 대체 경로 버튼. 다시 시도·다른 화면으로 가기 같은 것 (design-system.md §7-13) */
  action?: ReactNode
  className?: string
}

const BODY = 'text-body text-ink'

/**
 * 폼 상단의 비필드 오류 (D-142). 특정 칸의 잘못이 아닌 실패 — 잘못된 자격 증명, 네트워크, 서버 오류.
 * 칸 오류는 여기 오지 않는다. 입력 아래 `ErrorText` 로 가고 `setError` 로 폼에 반영한다.
 *
 * 유채 오류 박스를 쓰지 않는다. 눌린 면(Panel) + 먹 본문 + 대체 경로 버튼이다 (§7-13).
 * 아이콘도 붙이지 않는다. 나타나는 순간 읽히도록 `role="alert"` 다.
 */
export function FormErrorPanel({ message, action, className }: FormErrorPanelProps) {
  if (!message) return null
  return (
    <Panel role="alert" className={className}>
      <p className={BODY}>{message}</p>
      {action === undefined ? null : <div className="flex">{action}</div>}
    </Panel>
  )
}
