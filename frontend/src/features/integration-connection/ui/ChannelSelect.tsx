import type { ChatChannel } from '@/entities/integration'

export interface ChannelSelectProps {
  id: string
  /** 고른 채널 ID. null 이면 `사용 안 함` 이다 */
  value: string | null
  channels: readonly ChatChannel[]
  onChange: (channelId: string | null) => void
  disabled: boolean
  /** 목록을 받는 중이다 */
  busy: boolean
  'aria-describedby'?: string
}

const NONE = ''

/* 제품 입력(TextField product)과 같은 높이·반경·경계·꺼짐 색이다 */
const SELECT =
  'h-[42px] w-full rounded-9 border border-input-border bg-surface px-13 text-body font-normal text-ink disabled:cursor-default disabled:border-line disabled:bg-surface-sunken disabled:text-faint'

/**
 * 회의 채팅 채널 선택 상자. 공용 선택 상자(#471 `shared/ui/select`)가 생기면 이 파일만 바꾼다 — 그때까지 네이티브 `<select>` 다
 */
export function ChannelSelect({
  id,
  value,
  channels,
  onChange,
  disabled,
  busy,
  'aria-describedby': describedBy,
}: ChannelSelectProps) {
  return (
    <select
      id={id}
      className={SELECT}
      value={value ?? NONE}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value === NONE ? null : event.target.value)}
    >
      <option value={NONE}>사용 안 함</option>
      {channels.map((channel) => (
        <option key={channel.channelId} value={channel.channelId}>
          #{channel.name}
        </option>
      ))}
    </select>
  )
}
