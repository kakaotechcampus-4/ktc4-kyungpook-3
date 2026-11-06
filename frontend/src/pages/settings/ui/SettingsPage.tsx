import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import {
  DiscordConnectionSection,
  NotionConnectionSection,
} from '@/features/integration-connection'
import { SETTINGS_PARAMS } from '@/shared/config/routes'
import { useRouteId } from '@/shared/lib/url'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { TextField } from '@/shared/ui/text-field'
import { AutoApplySection } from './AutoApplySection'
import { DeleteTeamSection } from './DeleteTeamSection'
import { NotificationSection } from './NotificationSection'
import { SettingsNav } from './SettingsNav'
import type { SettingsSectionId } from './settingsSections'
import { SettingsSection } from './SettingsSection'

/* Settings 캔버스 — main 패딩 48/48/72, 안쪽 1000px 에 목차 176px 과 본문(간격 44), 절 사이 40px */
const MAIN = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72'
const COLUMNS = 'flex w-full max-w-column items-start gap-44'
const ASIDE = 'sticky top-[34px] flex w-[176px] shrink-0 flex-col gap-16'
/* 제목은 들어올 때 포커스를 받는 자리다(tabIndex -1). 절 제목과 같이 포커스 표시는 없다 */
const TITLE =
  'px-10 text-[22px] leading-[1.4] font-bold tracking-h1 text-ink focus-visible:outline-none'
const CONTENT = 'flex min-w-[0px] flex-1 flex-col gap-40'

/**
 * 설정 화면 (Settings 캔버스). 목차 · 일반 · 연결 · 자동 반영 기준 · 알림 · 이 팀 삭제하기.
 * 연결은 Discord·Notion 카드다 — 온보딩에서 건너뛴 연결을 여기서 마친다 (D-011).
 * 이름·자동 반영·팀 삭제는 저장 API 가 없다. 알림은 메시지·알림 설정 API 로 저장한다 (#340). 이름은 `되돌리기` 만 있고 값이 처음과 다르면 dirty 다 — 이탈 확인을 건다.
 * 바꾸는 조작은 PM 만 한다. 일반 팀원은 이름·선택지·토글을 꺼진 채로 읽고 팀 삭제는 보지 않는다
 */
export function SettingsPage() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  if (workspace === null) return null
  return (
    <SettingsScreen
      key={workspace.id}
      workspaceId={workspace.id}
      initialName={workspace.name}
      isPm={workspace.role === 'pm'}
    />
  )
}

interface SettingsScreenProps {
  workspaceId: string
  initialName: string
  isPm: boolean
}

function SettingsScreen({ workspaceId, initialName, isPm }: SettingsScreenProps) {
  const [searchParams] = useSearchParams()
  // 차단 모달에서 Notion 연결로 왔는가. 들어온 주소로 한 번만 정한다
  const [cameForNotion] = useState(() => searchParams.get(SETTINGS_PARAMS.section) === 'notion')
  // 그렇다면 목차도 연결에 둔다
  const [current, setCurrent] = useState<SettingsSectionId>(
    cameForNotion ? 'settings-connections' : 'settings-general',
  )
  const titleRef = useRef<HTMLHeadingElement>(null)

  // 들어오면 화면 제목에서 읽기 시작한다 — 이전 화면의 메뉴 트리거나 body 에 포커스가 남지 않는다.
  // Notion 연결로 왔으면 Notion 카드 제목이 포커스를 가져가므로 두지 않는다
  useEffect(() => {
    if (!cameForNotion) titleRef.current?.focus({ preventScroll: true })
  }, [cameForNotion])
  const select = (id: SettingsSectionId) => {
    setCurrent(id)
    const section = document.getElementById(id)
    section?.scrollIntoView?.({ block: 'start' })
    // 키보드로 고른 사람도 그 절에서 읽기 시작하도록 제목에 포커스를 둔다
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true })
  }

  return (
    <main className={MAIN}>
      <div className={COLUMNS}>
        <aside className={ASIDE}>
          <h1 ref={titleRef} tabIndex={-1} className={TITLE}>
            설정
          </h1>
          <SettingsNav workspaceId={workspaceId} current={current} onSelect={select} />
        </aside>
        <div className={CONTENT}>
          <SettingsSection id="settings-general" title="일반">
            <WorkspaceNameField initialName={initialName} canManage={isPm} />
          </SettingsSection>
          <SettingsSection
            id="settings-connections"
            title="연결"
            description="연결을 끊으면 이미 반영한 내용은 그대로 남고, 새 내용만 쓰지 않게 됩니다."
          >
            <DiscordConnectionSection workspaceId={workspaceId} canManage={isPm} />
            <NotionConnectionSection workspaceId={workspaceId} canManage={isPm} />
          </SettingsSection>
          <AutoApplySection canManage={isPm} />
          <NotificationSection workspaceId={workspaceId} canManage={isPm} />
          {isPm ? <DeleteTeamSection /> : null}
        </div>
      </div>
    </main>
  )
}

interface WorkspaceNameFieldProps {
  initialName: string
  /** PM 만 고친다. 일반 팀원에게는 꺼진 칸이고 `되돌리기` 가 없다 — 다른 선택지·토글과 같다 */
  canManage: boolean
}

/** 워크스페이스 이름. 저장 API 가 없어 `되돌리기` 만 있다. 바꾼 채로 나가려 하면 이탈 확인이 묻는다 */
function WorkspaceNameField({ initialName, canManage }: WorkspaceNameFieldProps) {
  const [name, setName] = useState(initialName)
  const isDirty = name !== initialName
  useUnsavedChanges(isDirty)
  return (
    <div className="flex max-w-[420px] flex-col gap-12">
      <TextField
        label="워크스페이스 이름"
        value={name}
        disabled={!canManage}
        onChange={(event) => setName(event.target.value)}
      />
      {canManage ? (
        <div>
          <Button onClick={() => setName(initialName)} disabled={!isDirty}>
            되돌리기
          </Button>
        </div>
      ) : null}
    </div>
  )
}
