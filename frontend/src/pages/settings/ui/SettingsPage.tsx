import { useState } from 'react'
import { useMemberWorkspace } from '@/entities/workspace'
import {
  DiscordConnectionSection,
  NotionConnectionSection,
} from '@/features/integration-connection'
import { useRouteId } from '@/shared/lib/url'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { TextField } from '@/shared/ui/text-field'

const FORM = 'flex max-w-[420px] flex-col gap-12'

/**
 * 설정 화면. 지금은 이탈 확인을 눌러 볼 입력 한 칸과 Discord·Notion 연결 영역만 둔다 (M8-B B-1).
 * 이름 칸은 저장 API 가 없어 `되돌리기`만 있다. 값이 처음과 다르면 dirty 다. 그 밖의 설정 항목은 결정 대기다.
 */
export function SettingsPage() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  if (workspace === null) return null
  return (
    <SettingsDraft
      key={workspace.id}
      workspaceId={workspace.id}
      initialName={workspace.name}
      isPm={workspace.role === 'pm'}
    />
  )
}

interface SettingsDraftProps {
  workspaceId: string
  initialName: string
  isPm: boolean
}

function SettingsDraft({ workspaceId, initialName, isPm }: SettingsDraftProps) {
  const [name, setName] = useState(initialName)
  const isDirty = name !== initialName
  useUnsavedChanges(isDirty)

  return (
    <PagePlaceholder
      title="설정"
      description="지금은 이탈 확인을 점검하는 입력 한 칸과 Discord·Notion 연결만 있어요. 나머지 설정은 준비 중이에요."
    >
      <div className={FORM}>
        <TextField
          label="워크스페이스 이름"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button onClick={() => setName(initialName)} disabled={!isDirty}>
            되돌리기
          </Button>
        </div>
      </div>
      <DiscordConnectionSection workspaceId={workspaceId} canManage={isPm} />
      <NotionConnectionSection workspaceId={workspaceId} canManage={isPm} />
    </PagePlaceholder>
  )
}
