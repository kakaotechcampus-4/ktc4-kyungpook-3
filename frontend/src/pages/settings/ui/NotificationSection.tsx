import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import type { IntegrationStatus } from '@/entities/integration'
import { memberListQueryOptions, pmsOf } from '@/entities/member'
import type { Member } from '@/entities/member'
import { BrowserPushControl } from '@/features/browser-push'
import { OPTION_CARD, OPTION_DESCRIPTION, OPTION_TITLE } from './settingsStyles'
import { RadioCardGroup } from './RadioCardGroup'
import type { RadioCardOption } from './RadioCardGroup'
import { SettingsSection } from './SettingsSection'

/* 문구와 처음 켜짐은 D-174 설정 알림 항목이다. 캔버스 파일은 고치지 않는다 */
const SWITCHES = [
  {
    key: 'dueReminder',
    title: '마감 하루 전에 담당자에게 DM',
    description: '자동 승인을 켜지 않으면 보내기 전에 문구를 확인합니다',
    offEffect: '끄면 재촉 제안을 만들지 않습니다. 태스크 안내 DM은 그대로 보냅니다',
    initial: true,
  },
  {
    key: 'reminderAutoApprove',
    title: '재촉 자동 승인',
    description: '켜면 PM이 막지 않은 재촉은 발송 시각에 자동으로 나갑니다',
    offEffect: '끄면 승인하지 않은 재촉 제안은 그대로 남습니다',
    initial: false,
  },
  {
    key: 'minutesSummary',
    title: (
      <>
        회의 정리가 끝나면 <span className="text-sub tabular-nums">#회의록</span>에 요약 올리기
      </>
    ),
    description: '확인 중인 항목은 개수만 올라갑니다',
    offEffect: '끄면 채널에 올리지 않습니다',
    initial: true,
  },
  {
    key: 'silenceAlert',
    title: '사흘 넘게 응답이 없으면 나에게만 알려주기',
    description: '팀원에게는 아무것도 보내지 않습니다',
    offEffect: '끄면 PM 알림만 보내지 않습니다. 막힘 전환은 그대로 일어나고 보드 배지로 보입니다',
    initial: true,
  },
] as const satisfies readonly {
  key: string
  title: ReactNode
  description: string
  offEffect: string
  initial: boolean
}[]

type SwitchKey = (typeof SWITCHES)[number]['key']

const INITIAL = Object.fromEntries(SWITCHES.map(({ key, initial }) => [key, initial])) as Record<
  SwitchKey,
  boolean
>

type PmAlertMethod = 'web' | 'discord_dm' | 'both'

const METHODS: readonly RadioCardOption<PmAlertMethod>[] = [
  { value: 'web', title: '웹', description: 'Discord DM 없이 웹에만 표시합니다' },
  { value: 'discord_dm', title: 'Discord DM', description: 'Discord DM으로만 보냅니다' },
  { value: 'both', title: '둘 다', description: '웹에 표시하고 Discord DM도 보냅니다' },
]

const ROW = 'flex items-center gap-16 px-18 py-15 border-line'
/* 토글 — 켜짐은 먹 트랙에 흰 손잡이 오른쪽, 꺼짐은 비활성 면 트랙에 점선 테두리 손잡이 왼쪽 */
const TRACK =
  'inline-flex h-[23px] w-40 shrink-0 items-center rounded-999 p-3 leading-none aria-checked:bg-ink disabled:cursor-default'
const KNOB = 'h-[17px] w-[17px] rounded-999 bg-surface'
/* 꺼진 손잡이의 실선 테두리는 점선 색이다. `border-dashed` 는 모양까지 점선으로 바꿔 쓰지 않는다
   (docs/impl-decision/2026-09-16-border-dashed-name-collision.md) */
const KNOB_OFF = 'border border-(--color-dashed)'

const NOTICE = 'Discord가 연결되지 않아 웹으로만 알려요'

/** D-177 `웹으로만` 안내. 불러오는 중이거나 실패하면 보이지 않는다. Discord 가 `connected` 가 아니면(연결 중·끊김 포함) 보이고,
 *  연결돼 있으면 만든 PM(pmsOf[0])의 Discord 계정이 없을 때만 보인다. 서버를 떠난 계정(inactive)은 이 화면에서 보지 않는다.
 *  실제로 어디로 알릴지는 백엔드가 정한다(계약 §8). 여기서는 안내만 정한다 */
function pmWebOnly(
  discord: IntegrationStatus | undefined,
  members: readonly Member[] | undefined,
): boolean {
  if (discord === undefined) return false
  if (discord !== 'connected') return true
  if (members === undefined) return false
  return pmsOf(members)[0]?.discordUserId === null
}

export interface NotificationSectionProps {
  workspaceId: string
  /** PM 만 바꾼다. 일반 팀원은 지금 상태를 읽기만 한다 */
  canManage: boolean
}

/** 알림 (D-174 설정 알림 항목, D-177 안내). 저장 API 가 없어 화면 안에서만 바꾼다 — 새로 열면 D-174 기본값(세 토글 켜짐, 재촉 자동 승인 꺼짐, 둘 다)이다 */
export function NotificationSection({ workspaceId, canManage }: NotificationSectionProps) {
  const integrations = useQuery(integrationsQueryOptions(workspaceId))
  const members = useQuery(memberListQueryOptions(workspaceId))
  const webOnly = pmWebOnly(
    integrations.isError ? undefined : integrations.data?.discord.status,
    members.isError ? undefined : members.data,
  )
  const [enabled, setEnabled] = useState(INITIAL)
  const [method, setMethod] = useState<PmAlertMethod>('both')
  const methodLabelId = useId()
  const noticeId = useId()
  return (
    <SettingsSection id="settings-notifications" title="알림">
      <BrowserPushControl className={`${OPTION_CARD} ${ROW}`} />
      {SWITCHES.map(({ key, title, description, offEffect }) => {
        const on = enabled[key]
        const titleId = `settings-notification-${key}`
        const descriptionId = `settings-notification-${key}-description`
        const offId = `settings-notification-${key}-off`
        return (
          <div key={key} className={`${OPTION_CARD} ${ROW}`}>
            <div className="flex-1">
              <span id={titleId} className={`${OPTION_TITLE} ${on ? 'text-ink' : 'text-sub'}`}>
                {title}
              </span>
              <span id={descriptionId} className={`${OPTION_DESCRIPTION} text-dim`}>
                {description}
              </span>
              <span id={offId} className={`${OPTION_DESCRIPTION} text-dim`}>
                {offEffect}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={titleId}
              aria-describedby={`${descriptionId} ${offId}`}
              disabled={!canManage}
              onClick={() => setEnabled((current) => ({ ...current, [key]: !current[key] }))}
              className={`${TRACK} ${on ? '' : 'bg-inactive'}`}
            >
              <span className={on ? `ml-auto ${KNOB}` : `${KNOB} ${KNOB_OFF}`} />
            </button>
          </div>
        )
      })}
      <p id={methodLabelId} className={OPTION_TITLE}>
        PM 알림 방식
      </p>
      {webOnly ? (
        <p id={noticeId} className="text-caption text-sub">
          {NOTICE}
        </p>
      ) : null}
      <RadioCardGroup
        labelledBy={methodLabelId}
        describedBy={webOnly ? noticeId : undefined}
        options={METHODS}
        value={method}
        onChange={setMethod}
        disabled={!canManage}
      />
    </SettingsSection>
  )
}
