import { useId, useState } from 'react'
import type { DiscordIntegration } from '@/entities/integration'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Label } from '@/shared/ui/label'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Select } from '@/shared/ui/select'
import { chatChannelListFailure } from '../lib/chatChannelMessages'
import { useChatChannelSetting } from '../model/useChatChannelSetting'

export interface ChatChannelFieldProps {
  workspaceId: string
  integration: DiscordIntegration
}

const NOT_CONNECTED_NOTE = 'Discord를 먼저 연결해 주세요. 연결하면 회의 채팅 채널을 고를 수 있어요.'
/* #429 이슈 본문의 저장 전 안내다. 끝맺음만 해요체로 다듬었다 */
const SAVE_NOTICE =
  '이 채널 대화는 매일 09:00에 읽혀 task 제안에 쓰여요. 저장하면 봇이 채널에 안내 메시지를 남겨요. 제안은 PM 승인 뒤에만 반영돼요.'

const NONE_OPTION = { label: '사용 안 함' }

const NOTE = 'mt-6 text-[12px] font-normal text-dim'
const NOTICE = 'mt-6 text-caption text-sub'

/**
 * 회의 채팅 채널 (#429). PM 이 Discord 텍스트 채널을 고르면 매일 09:00 채팅 자동 수집이 켜지고, `사용 안 함` 이면 꺼진다.
 * 고른 값은 저장하기 전까지 이 칸에만 있다 — 켜거나 바꾸려 하면 무엇이 일어나는지 저장 전에 알린다.
 * 저장한 채널이 지금 목록에 없어도(이름이 바뀌었거나 봇이 못 보게 됐다) 지금 값으로 보인다
 */
export function ChatChannelField({ workspaceId, integration }: ChatChannelFieldProps) {
  const connected = integration.status === 'connected'
  const setting = useChatChannelSetting(workspaceId, connected)
  // undefined 면 서버 값을 따른다
  const [draft, setDraft] = useState<string | null | undefined>(undefined)
  const saved = integration.chatChannel
  const savedId = saved?.channelId ?? null
  const listed = setting.channels.data ?? []
  const channels =
    saved !== null && !listed.some(({ channelId }) => channelId === saved.channelId)
      ? [saved, ...listed]
      : listed
  // 고른 채널이 다시 받은 목록에서 사라졌으면(저장이 NOT_FOUND) 저장한 값으로 돌아간다 — 빈칸에서 같은 PUT 을 다시 보내지 않는다
  const draftListed = draft === null || channels.some(({ channelId }) => channelId === draft)
  const selected = connected && draft !== undefined && draftListed ? draft : savedId
  const isDirty = selected !== savedId
  useUnsavedChanges(isDirty)

  const id = useId()
  const noteId = `${id}-note`
  const noticeId = `${id}-notice`
  const failureId = `${id}-failure`
  const showNotice = isDirty && selected !== null

  const options = channels.map(({ channelId, name }) => ({ value: channelId, label: `#${name}` }))

  const change = (channelId: string | null) => {
    setDraft(channelId)
    setting.clearFailure()
  }

  return (
    <div className="flex max-w-[420px] flex-col">
      <Label htmlFor={id} className="mb-6">
        회의 채팅 채널
      </Label>
      <div aria-busy={setting.channels.loading || undefined}>
        <Select
          id={id}
          value={selected}
          onValueChange={change}
          options={options}
          noneOption={NONE_OPTION}
          disabled={!connected || setting.channels.loading || setting.saving}
          aria-invalid={setting.failure !== null}
          aria-describedby={
            [!connected ? noteId : showNotice ? noticeId : null, setting.failure && failureId]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
      </div>
      {connected ? null : (
        <p id={noteId} className={NOTE}>
          {NOT_CONNECTED_NOTE}
        </p>
      )}
      {showNotice ? (
        <p id={noticeId} className={NOTICE}>
          {SAVE_NOTICE}
        </p>
      ) : null}
      {setting.channels.error ? (
        <div className="mt-8">
          <QueryErrorState
            error={setting.channels.error}
            onRetry={setting.channels.retry}
            title="채널 목록을 불러오지 못했어요"
            message={chatChannelListFailure(setting.channels.error) ?? undefined}
          />
        </div>
      ) : null}
      <div id={failureId}>
        <FormErrorPanel message={setting.failure} className="mt-8" />
      </div>
      {isDirty ? (
        <div className="mt-12 flex gap-8">
          <Button
            variant="primary"
            loading={setting.saving}
            onClick={() => setting.save(selected, () => setDraft(undefined))}
          >
            저장
          </Button>
          <Button
            disabled={setting.saving}
            onClick={() => {
              setDraft(undefined)
              setting.clearFailure()
            }}
          >
            되돌리기
          </Button>
        </div>
      ) : null}
    </div>
  )
}
