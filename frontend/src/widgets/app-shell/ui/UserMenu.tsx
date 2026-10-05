import { useQuery } from '@tanstack/react-query'
import { sessionQueryOptions } from '@/entities/user'
import { LOGOUT_FAILED_MESSAGE, useLogout } from '@/features/auth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'

/* Main 의 아바타 — 29px 원 · 11px 600. 캔버스는 이름 두 글자(`지훈`)다 */
const AVATAR =
  'inline-flex h-[29px] w-[29px] items-center justify-center rounded-999 bg-divider text-[11px] leading-none font-semibold text-ink data-[state=open]:bg-line-strong'

const FAILURE = 'text-caption text-sub'

/** 이름의 마지막 두 글자. `최진호` → `진호`. 한 글자면 그대로다 */
function initials(name: string): string {
  const letters = Array.from(name.trim())
  return letters.slice(-2).join('')
}

/**
 * 사용자 메뉴. 지금은 `로그아웃` 하나다. 로그아웃은 저장하지 않은 변경이 있으면 먼저 묻고,
 * 서버가 성공한 뒤에만 캐시를 지우고 로그인으로 간다 (useLogout). 실패하면 아바타 옆에 안내가 남는다.
 */
export function UserMenu() {
  const session = useQuery(sessionQueryOptions())
  const { requestLogout, isPending, error } = useLogout()
  const user = session.data?.user

  return (
    <span className="inline-flex items-center gap-8">
      {error ? (
        <span role="alert" className={FAILURE}>
          {LOGOUT_FAILED_MESSAGE}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger className={AVATAR} aria-label={`내 계정: ${user?.name ?? ''}`}>
          {user ? initials(user.name) : ''}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[240px]">
          {/* 묶음 제목(대문자 · 자간) 모양이 아니라 계정 정보라 Label 대신 평범한 칸이다 */}
          <div className="flex flex-col gap-2 px-10 py-5">
            <span className="text-control font-semibold text-ink">{user?.name}</span>
            <span className="text-[11px] text-dim">{user?.email}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isPending} onSelect={requestLogout}>
            <Icon name="logout" size={15} className="shrink-0 text-sub" />
            <span className="flex-1 text-control font-semibold text-sub">로그아웃</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
