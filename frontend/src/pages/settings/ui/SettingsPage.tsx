import { useState } from 'react'
import { useMemberWorkspace } from '@/entities/workspace'
import { NotionConnectionSection } from '@/features/notion-connection'
import { useRouteId } from '@/shared/lib/url'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { TextField } from '@/shared/ui/text-field'

const FORM = 'flex max-w-[420px] flex-col gap-12'

/**
 * 설정 화면은 M8 이다. 지금은 이탈 확인을 눌러 볼 입력 한 칸과, M5 가 앞당긴 Notion 연결 영역만 둔다.
 * 저장 API 가 없어 `되돌리기`만 있다. 값이 처음과 다르면 dirty 다.
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
      description="설정 화면은 M8에서 만들어요. 지금은 이탈 확인을 점검하는 입력 한 칸과 Notion 연결만 있어요."
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
      <NotionConnectionSection workspaceId={workspaceId} canManage={isPm} />
    </PagePlaceholder>
  )
}
