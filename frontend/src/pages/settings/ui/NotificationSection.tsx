import { useId } from 'react'
import type { ReactNode } from 'react'
import { NUDGE_DAYS_BEFORE, nudgeHourLabel, nudgeRuleLabel } from '@/entities/message-settings'
import type {
  MessageSettings,
  MessageSettingsChange,
  PmAlertMethod,
} from '@/entities/message-settings'
import { BrowserPushControl } from '@/features/browser-push'
import { useMessageSettings } from '@/features/message-settings'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Select } from '@/shared/ui/select'
import type { SelectOption } from '@/shared/ui/select'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import { existingSuggestionNote, pmWebOnlyNotice } from '../lib/notificationCopy'
import { OPTION_CARD, OPTION_DESCRIPTION, OPTION_TITLE } from './settingsStyles'
import { RadioCardGroup } from './RadioCardGroup'
import type { RadioCardOption } from './RadioCardGroup'
import { SettingsSection } from './SettingsSection'

type SwitchKey = 'dueReminder' | 'reminderAutoApprove' | 'minutesSummary' | 'silenceAlert'

interface SwitchCopy {
  key: SwitchKey
  title: ReactNode
  description: string
  offEffect: string
  /** 저장만 되고 아직 동작하지 않는 항목의 안내 */
  note?: string
}

const NOT_YET = '아직 준비 중이라 설정만 저장돼요'

/* 문구는 D-174 설정 알림 항목이다. 캔버스 파일은 고치지 않는다. 재촉 제목은 저장된 재촉 규칙을 따른다 */
function switchCopies(settings: MessageSettings): SwitchCopy[] {
  return [
    {
      key: 'dueReminder',
      title: `${nudgeRuleLabel(settings.nudgeRule)}에 담당자에게 DM`,
      description: '자동 승인을 켜지 않으면 보내기 전에 문구를 확인합니다',
      offEffect: settings.reminderAutoApprove
        ? '끄면 재촉 제안을 만들지 않고, 이미 만든 제안도 자동으로 보내지 않습니다. 태스크 안내 DM은 그대로 보냅니다'
        : '끄면 재촉 제안을 만들지 않습니다. 태스크 안내 DM은 그대로 보냅니다',
    },
    {
      key: 'reminderAutoApprove',
      title: '재촉 자동 승인',
      description: '켜면 PM이 막지 않은 재촉은 발송 시각에 자동으로 나갑니다',
      offEffect: '끄면 승인하지 않은 재촉 제안은 그대로 남습니다',
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
      note: NOT_YET,
    },
    {
      key: 'silenceAlert',
      title: '사흘 넘게 응답이 없으면 나에게만 알려주기',
      description: '팀원에게는 아무것도 보내지 않습니다',
      offEffect: '끄면 PM 알림만 보내지 않습니다. 막힘 전환은 그대로 일어나고 보드 배지로 보입니다',
    },
  ]
}

const METHODS: readonly RadioCardOption<PmAlertMethod>[] = [
  { value: 'web', title: '웹', description: 'Discord DM 없이 웹에만 표시합니다' },
  { value: 'discord_dm', title: 'Discord DM', description: 'Discord DM으로만 보냅니다' },
  { value: 'both', title: '둘 다', description: '웹에 표시하고 Discord DM도 보냅니다' },
]

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const ROW = 'flex items-center gap-16 px-18 py-15 border-line'
/* 토글 — 켜짐은 먹 트랙에 흰 손잡이 오른쪽, 꺼짐은 비활성 면 트랙에 점선 테두리 손잡이 왼쪽 */
const TRACK =
  'inline-flex h-[23px] w-40 shrink-0 items-center rounded-999 p-3 leading-none aria-checked:bg-ink disabled:cursor-default'
const KNOB = 'h-[17px] w-[17px] rounded-999 bg-surface'
/* 꺼진 손잡이의 실선 테두리는 점선 색이다. `border-dashed` 는 모양까지 점선으로 바꿔 쓰지 않는다
   (docs/impl-decision/2026-09-16-border-dashed-name-collision.md) */
const KNOB_OFF = 'border border-(--color-dashed)'
const CAPTION = 'text-caption text-sub'

export interface NotificationSectionProps {
  workspaceId: string
  /** PM 만 바꾼다. 일반 팀원은 서버의 지금 값을 읽기만 한다 */
  canManage: boolean
}

/**
 * 알림 (D-174 설정 알림 항목, D-177 안내). 메시지·알림 설정 API 에서 읽고, PM 이 바꾸면 바꾼 칸만 저장한다 (#340).
 * PM 알림 방식과 회의록 요약은 아직 서버가 저장만 한다 — 그렇다고 안내한다
 */
export function NotificationSection({ workspaceId, canManage }: NotificationSectionProps) {
  const { settings, error, retry, change } = useMessageSettings(workspaceId)
  const indicator = useLoadingIndicator(settings === undefined && !error)
  return (
    <SettingsSection
      id="settings-notifications"
      title="알림"
      description={settings === undefined ? undefined : existingSuggestionNote(settings)}
    >
      <BrowserPushControl className={`${OPTION_CARD} ${ROW}`} />
      {indicator.pending ? (
        <DeferredSkeleton indicator={indicator} className="flex flex-col gap-10">
          {/* 알림 칸과 같은 틀 — 제목 · 설명 두 줄과 오른쪽 토글. 칸마다 문구는 설정을 받아야 알아 막대다 (#508) */}
          {[0, 1].map((card) => (
            <div key={card} aria-hidden="true" className={`${OPTION_CARD} ${ROW} border-line`}>
              <div className="flex flex-1 flex-col gap-4">
                <div className="flex h-lh items-center text-body">
                  <Skeleton width={`${[48, 40][card]}%`} />
                </div>
                <div className="flex h-lh items-center text-caption">
                  <Skeleton width="64%" />
                </div>
              </div>
              <span className="h-[23px] w-40 shrink-0 rounded-999 bg-control" />
            </div>
          ))}
        </DeferredSkeleton>
      ) : (
        <Reveal indicator={indicator}>
          {settings !== undefined ? (
            <NotificationControls settings={settings} canManage={canManage} onChange={change} />
          ) : (
            <QueryErrorState error={error} onRetry={retry} />
          )}
        </Reveal>
      )}
    </SettingsSection>
  )
}

function NotificationControls({
  settings,
  canManage,
  onChange,
}: {
  settings: MessageSettings
  canManage: boolean
  onChange: (change: MessageSettingsChange) => void
}) {
  const methodLabelId = useId()
  const noticeId = useId()
  const methodNoteId = useId()
  const webOnly = pmWebOnlyNotice(settings.pms)
  return (
    <>
      {switchCopies(settings).map(({ key, title, description, offEffect, note }) => {
        const on = settings[key]
        const titleId = `settings-notification-${key}`
        const descriptionId = `settings-notification-${key}-description`
        const offId = `settings-notification-${key}-off`
        const noteId = `settings-notification-${key}-note`
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
              {note === undefined ? null : (
                <span id={noteId} className={`${OPTION_DESCRIPTION} text-sub`}>
                  {note}
                </span>
              )}
              {key === 'dueReminder' ? (
                <NudgeRuleFields settings={settings} canManage={canManage} onChange={onChange} />
              ) : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={titleId}
              aria-describedby={[descriptionId, offId, note === undefined ? null : noteId]
                .filter(Boolean)
                .join(' ')}
              disabled={!canManage}
              onClick={() => onChange({ [key]: !on })}
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
      <p id={methodNoteId} className={CAPTION}>
        지금은 웹으로만 알려요. Discord DM은 준비 중이라 고른 방식은 저장만 돼요.
      </p>
      {webOnly === null ? null : (
        <p id={noticeId} className={CAPTION}>
          {webOnly}
        </p>
      )}
      <RadioCardGroup
        labelledBy={methodLabelId}
        describedBy={webOnly === null ? methodNoteId : `${noticeId} ${methodNoteId}`}
        options={METHODS}
        value={settings.pmAlertMethod}
        onChange={(pmAlertMethod) => onChange({ pmAlertMethod })}
        disabled={!canManage}
      />
    </>
  )
}

/* 문장 「마감 [1일 전] [09:00]에 보내요」 안의 칸이라 「마감」 을 앞 글자로 빼고 줄인다 (시안 select-design.html 4) */
const DAY_OPTIONS: readonly SelectOption<string>[] = NUDGE_DAYS_BEFORE.map((days) => ({
  value: String(days),
  label: days === 0 ? '당일' : `${String(days)}일 전`,
}))

const HOUR_OPTIONS: readonly SelectOption<string>[] = HOURS.map((hour) => ({
  value: String(hour),
  label: nudgeHourLabel(hour),
}))

/** 재촉 규칙 — 마감 며칠 전(0~3) · 몇 시(0~23시 정시, 한국 시간). 바꾸면 규칙 전체를 보낸다 */
function NudgeRuleFields({
  settings,
  canManage,
  onChange,
}: {
  settings: MessageSettings
  canManage: boolean
  onChange: (change: MessageSettingsChange) => void
}) {
  const rule = settings.nudgeRule
  return (
    <div className="mt-8 flex flex-wrap items-center gap-8 text-body text-ink">
      <span>마감</span>
      <div className="w-[96px]">
        <Select
          size="sm"
          label="재촉 며칠 전"
          aria-label="재촉 며칠 전"
          value={String(rule.daysBefore)}
          options={DAY_OPTIONS}
          disabled={!canManage}
          onValueChange={(value) => {
            const daysBefore = NUDGE_DAYS_BEFORE.find((days) => String(days) === value)
            if (daysBefore !== undefined) onChange({ nudgeRule: { ...rule, daysBefore } })
          }}
        />
      </div>
      <div className="w-[92px]">
        <Select
          size="sm"
          label="재촉 보낼 시각"
          aria-label="재촉 보낼 시각"
          value={String(rule.hour)}
          options={HOUR_OPTIONS}
          disabled={!canManage}
          onValueChange={(value) => {
            const hour = HOURS.find((each) => String(each) === value)
            if (hour !== undefined) onChange({ nudgeRule: { ...rule, hour } })
          }}
        />
      </div>
      <span>에 보내요</span>
    </div>
  )
}
