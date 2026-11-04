import { useState } from 'react'
import type { ReactNode } from 'react'
import { OPTION_CARD, OPTION_DESCRIPTION, OPTION_TITLE } from './settingsStyles'
import { SettingsSection } from './SettingsSection'

type NotificationKey = 'dueReminder' | 'minutesSummary' | 'silenceAlert'

interface NotificationOption {
  key: NotificationKey
  title: ReactNode
  description: string
}

/* 문구와 처음 켜짐은 Settings 캔버스 그대로다 */
const OPTIONS: readonly NotificationOption[] = [
  {
    key: 'dueReminder',
    title: '마감 하루 전에 담당자에게 DM',
    description: '문구는 보내기 전에 항상 확인합니다',
  },
  {
    key: 'minutesSummary',
    title: (
      <>
        회의 정리가 끝나면 <span className="text-sub tabular-nums">#회의록</span>에 요약 올리기
      </>
    ),
    description: '확인이 끝난 항목만 올라갑니다',
  },
  {
    key: 'silenceAlert',
    title: '사흘 넘게 응답이 없으면 나에게만 알려주기',
    description: '팀원에게는 아무것도 보내지 않습니다',
  },
]

const INITIAL: Record<NotificationKey, boolean> = {
  dueReminder: true,
  minutesSummary: true,
  silenceAlert: false,
}

const ROW = 'flex items-center gap-16 px-18 py-15 border-line'
/* 토글 — 켜짐은 먹 트랙에 흰 손잡이 오른쪽, 꺼짐은 비활성 면 트랙에 점선 테두리 손잡이 왼쪽 */
const TRACK =
  'inline-flex h-[23px] w-40 shrink-0 items-center rounded-999 p-3 leading-none aria-checked:bg-ink disabled:cursor-default'
const KNOB = 'h-[17px] w-[17px] rounded-999 bg-surface'
/* 꺼진 손잡이의 실선 테두리는 점선 색이다. `border-dashed` 는 모양까지 점선으로 바꿔 쓰지 않는다
   (docs/impl-decision/2026-09-16-border-dashed-name-collision.md) */
const KNOB_OFF = 'border border-(--color-dashed)'

export interface NotificationSectionProps {
  /** PM 만 바꾼다. 일반 팀원은 지금 상태를 읽기만 한다 */
  canManage: boolean
}

/** 알림 (Settings 캔버스). 저장 API 가 없어 화면 안에서만 켜고 끈다 — 새로 열면 캔버스의 처음 상태다 */
export function NotificationSection({ canManage }: NotificationSectionProps) {
  const [enabled, setEnabled] = useState(INITIAL)
  return (
    <SettingsSection id="settings-notifications" title="알림">
      {OPTIONS.map(({ key, title, description }) => {
        const on = enabled[key]
        const titleId = `settings-notification-${key}`
        return (
          <div key={key} className={`${OPTION_CARD} ${ROW}`}>
            <div className="flex-1">
              <span id={titleId} className={`${OPTION_TITLE} ${on ? 'text-ink' : 'text-sub'}`}>
                {title}
              </span>
              <span className={`${OPTION_DESCRIPTION} text-dim`}>{description}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={titleId}
              disabled={!canManage}
              onClick={() => setEnabled((current) => ({ ...current, [key]: !current[key] }))}
              className={`${TRACK} ${on ? '' : 'bg-inactive'}`}
            >
              <span className={on ? `ml-auto ${KNOB}` : `${KNOB} ${KNOB_OFF}`} />
            </button>
          </div>
        )
      })}
    </SettingsSection>
  )
}
