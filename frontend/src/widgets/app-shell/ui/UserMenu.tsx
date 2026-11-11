import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { sessionQueryOptions } from '@/entities/user'
import { LOGOUT_FAILED_MESSAGE, useLogout } from '@/features/auth'
import { QuickGuidePanel } from '@/features/quick-guide'
import type { QuickGuideForm } from '@/features/quick-guide'
import { paths } from '@/shared/config/routes'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { hasPendingLeave, useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'
import { SHELL_TABS } from '../model/shellTabs'

/* Main 의 아바타 — 29px 원 · 11px 600. 캔버스는 이름 두 글자(`지훈`)다 */
const AVATAR =
  'inline-flex h-[29px] w-[29px] items-center justify-center rounded-999 bg-divider text-[11px] leading-none font-semibold text-ink data-[state=open]:bg-line-strong'

const FAILURE = 'text-caption text-sub'

const ITEM_ICON = 'shrink-0 text-sub'
const ITEM_TEXT = 'flex-1 text-control font-semibold text-sub'

/* 아래 탭 막대에 자리가 없는 셸 탭. 768px 미만에서만 이 메뉴에 둔다 (#551) */
const MENU_TABS = SHELL_TABS.filter(({ compact }) => compact === 'menu')

/** 이름의 마지막 두 글자. `최진호` → `진호`. 한 글자면 그대로다 */
function initials(name: string): string {
  const letters = Array.from(name.trim())
  return letters.slice(-2).join('')
}

export interface UserMenuProps {
  /** 지금 보고 있는 공간. 있을 때만 `설정` 을 둔다 — 선택 화면처럼 공간을 고르기 전에는 갈 설정이 없다 */
  workspaceId?: string
}

/**
 * 사용자(프로필) 메뉴 — `설정`·`사용법 보기`·`로그아웃`. 768px 미만에서는 아래 탭 막대에 없는 셸 탭(프로젝트 맵)이 `설정` 위에 있다 (#551).
 * 설정과 로그아웃은 저장하지 않은 변경이 있으면 먼저 묻는다.
 * `설정` 은 #244 사용자 요청으로 워크스페이스 메뉴에서 옮겨 왔다. 이동은 관문(useGuardedNavigate)을 탄다.
 * 로그아웃은 서버가 성공한 뒤에만 캐시를 지우고 로그인으로 간다 (useLogout). 실패하면 아바타 옆에 안내가 남는다.
 * 논모달이다(`modal={false}`) — 열려 있어도 뒤 화면을 aria-hidden·pointer-events·스크롤 잠금으로 막지 않는다.
 * 바깥 클릭·Esc 로 닫히고 Esc 로 닫으면 아바타로 포커스가 돌아오는 것은 Radix 가 그대로 한다.
 * 다만 `설정` 으로 실제로 옮겨 갔으면 아바타로 돌리지 않는다 — 새 화면(설정)이 제목으로 포커스를 가져간다.
 */
export function UserMenu({ workspaceId }: UserMenuProps) {
  const session = useQuery(sessionQueryOptions())
  const { requestLogout, isPending, error } = useLogout()
  const navigate = useGuardedNavigate()
  const compact = useCompactScreen()
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideForm, setGuideForm] = useState<QuickGuideForm>('modal')
  const user = session.data?.user
  const triggerRef = useRef<HTMLButtonElement>(null)
  // 새 화면이나 안내 창이 가져간 포커스를 메뉴 닫힘이 되돌리지 않는다.
  const skipFocusReturn = useRef(false)

  const openScreen = (path: string) => {
    skipFocusReturn.current = navigate(path)
    // 이탈 확인이 붙잡았으면 그 창을 연 요소가 아바타가 되게 먼저 옮긴다 — `계속 작성하기` 로 닫으면 아바타로 돌아온다
    if (hasPendingLeave()) triggerRef.current?.focus()
  }

  const openGuide = () => {
    triggerRef.current?.focus()
    skipFocusReturn.current = true
    setGuideForm(compact ? 'sheet' : 'modal')
    setGuideOpen(true)
  }

  return (
    <span className="inline-flex items-center gap-8">
      {error ? (
        <span role="alert" className={FAILURE}>
          {LOGOUT_FAILED_MESSAGE}
        </span>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={triggerRef}
          className={AVATAR}
          aria-label={`내 계정: ${user?.name ?? ''}`}
        >
          {user ? initials(user.name) : ''}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[240px]"
          onCloseAutoFocus={(event) => {
            if (!skipFocusReturn.current) return
            skipFocusReturn.current = false
            event.preventDefault()
          }}
        >
          {/* 묶음 제목(대문자 · 자간) 모양이 아니라 계정 정보라 Label 대신 평범한 칸이다 */}
          <div className="flex flex-col gap-2 px-10 py-5">
            <span className="text-control font-semibold text-ink">{user?.name}</span>
            {/* 카카오로 가입한 계정은 이메일이 없어 아이디를 보인다 (#627) */}
            <span className="text-[11px] text-dim">
              {user ? (user.email ?? user.username) : null}
            </span>
          </div>
          <DropdownMenuSeparator />
          {workspaceId === undefined || !compact
            ? null
            : MENU_TABS.map(({ key, label, icon, to }) => (
                <DropdownMenuItem key={key} onSelect={() => openScreen(to(workspaceId))}>
                  <Icon name={icon} size={15} className={ITEM_ICON} />
                  <span className={ITEM_TEXT}>{label}</span>
                </DropdownMenuItem>
              ))}
          {workspaceId === undefined ? null : (
            <DropdownMenuItem onSelect={() => openScreen(paths.settings(workspaceId))}>
              <Icon name="settings" size={15} className={ITEM_ICON} />
              <span className={ITEM_TEXT}>설정</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={openGuide} aria-haspopup="dialog">
            <Icon name="help" size={15} className={ITEM_ICON} />
            <span className={ITEM_TEXT}>사용법 보기</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isPending} onSelect={requestLogout}>
            <Icon name="logout" size={15} className={ITEM_ICON} />
            <span className={ITEM_TEXT}>로그아웃</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              skipFocusReturn.current = navigate(paths.withdrawal())
            }}
          >
            <span className={ITEM_TEXT}>계정 탈퇴</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuickGuidePanel
        open={guideOpen}
        onOpenChange={setGuideOpen}
        form={guideForm}
        returnFocus={() => triggerRef.current}
      />
    </span>
  )
}
