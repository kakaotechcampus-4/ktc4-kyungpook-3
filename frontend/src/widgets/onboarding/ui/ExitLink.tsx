import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { onboardingExitPath } from '@/features/onboarding'
import { clearReturnWorkspace, readReturnWorkspace } from '@/shared/lib/return-workspace'
import { GuardedLink, guardLeave } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'

export interface ExitLinkProps {
  /**
   * 나가기 전에 할 일 — 팀원 연결의 입력 중 매핑 저장. true 면 나가고, false 면 화면에 남는다.
   * 없으면 그냥 링크다. 저장하지 않은 입력이 있으면 공통 이탈 확인을 거친다.
   */
  beforeLeave?: () => Promise<boolean>
}

const LINK =
  'inline-flex h-36 w-36 items-center justify-center rounded-9 text-sub hover:bg-control aria-busy:text-faint'

/**
 * 온보딩 왼쪽 위의 나가기 화살표 (D-069). 진행 상태는 단계마다 서버에 이미 저장돼 있다.
 * 목적지는 새 공간 만들기를 시작한 기존 공간의 대시보드, 없으면 워크스페이스 선택 화면이다.
 */
export function ExitLink({ beforeLeave }: ExitLinkProps) {
  const workspaces = useQuery(workspaceListQueryOptions())
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const to = onboardingExitPath(workspaces.data ?? [], readReturnWorkspace())

  /* 관문(guardLeave)에 넣는 이동 한 번. 실제로 나갈 때만 돌아올 공간 기억을 지운다 —
     이탈 확인에서 `계속 작성하기` 를 고르면 기억이 남아 다음 나가기도 같은 곳으로 간다.
     주소창으로 다른 미완료 공간에 들어가 나가기를 눌러도 앞의 공간으로 돌아가지 않는다 */
  const leave = () =>
    guardLeave(() => {
      clearReturnWorkspace()
      void navigate(to)
    })

  return (
    <GuardedLink
      to={to}
      aria-label="온보딩 나가기"
      aria-busy={leaving || undefined}
      className={LINK}
      onClick={(event) => {
        event.preventDefault()
        if (beforeLeave === undefined) {
          leave()
          return
        }
        if (leaving) return
        setLeaving(true)
        void beforeLeave().then((ok) => {
          setLeaving(false)
          if (ok) leave()
        })
      }}
    >
      <Icon name="arrow-left" size={18} />
    </GuardedLink>
  )
}
