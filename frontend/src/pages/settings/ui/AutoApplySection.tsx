import { useId, useState } from 'react'
import { OPTION_CARD, OPTION_DESCRIPTION, OPTION_TITLE } from './settingsStyles'
import { SettingsSection } from './SettingsSection'

type AutoApplyPolicy = 'review_all' | 'clear_only' | 'apply_all'

interface PolicyOption {
  value: AutoApplyPolicy
  title: string
  description: string
  /** 고를 수 없는 선택지. 캔버스가 `지원하지 않습니다` 로 그린 것이다 */
  unsupported?: boolean
}

/* 문구는 Settings 캔버스 그대로다 */
const OPTIONS: readonly PolicyOption[] = [
  {
    value: 'review_all',
    title: '전부 내가 확인한다',
    description: '회의에서 나온 모든 항목이 확인 대기로 올라옵니다',
  },
  {
    value: 'clear_only',
    title: '담당자·마감이 분명한 건만 자동으로',
    description:
      '"제가 목요일까지 할게요"처럼 본인이 직접 말한 경우만. 나머지는 확인 대기로 올라옵니다',
  },
  {
    value: 'apply_all',
    title: '전부 자동으로 올린다',
    description: '지원하지 않습니다 — 확인 없는 반영은 틀린 내용을 팀 전체에 퍼뜨립니다',
    unsupported: true,
  },
]

const OPTION =
  'flex cursor-pointer items-start gap-13 px-18 py-16 has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-ink'
const RADIO =
  'mt-3 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-999 border leading-none'

export interface AutoApplySectionProps {
  /** PM 만 고른다. 일반 팀원은 지금 기준을 읽기만 한다 */
  canManage: boolean
}

/**
 * 자동 반영 기준 (Settings 캔버스). 저장 API 가 없어 화면 안에서만 고른다 — 새로 열면 캔버스의 기본값(가운데)이다.
 * `전부 자동으로 올린다` 는 캔버스대로 고를 수 없다
 */
export function AutoApplySection({ canManage }: AutoApplySectionProps) {
  const [policy, setPolicy] = useState<AutoApplyPolicy>('clear_only')
  const name = useId()
  return (
    <SettingsSection
      id="settings-auto-apply"
      title="자동 반영 기준"
      description="어디까지를 사람이 보지 않고 Notion에 올릴지 정합니다. 무엇을 올리든 로그에 남고 되돌릴 수 있어요."
    >
      <div role="radiogroup" aria-labelledby="settings-auto-apply-title" className="contents">
        {OPTIONS.map((option) => {
          const checked = policy === option.value
          return (
            <label
              key={option.value}
              className={`${OPTION_CARD} ${OPTION} ${checked ? 'border-line-strong' : 'border-line'}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={!canManage || option.unsupported === true}
                onChange={() => setPolicy(option.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`${RADIO} ${option.unsupported ? 'border-line-strong' : 'border-faint'}`}
              >
                {checked ? <span className="h-8 w-8 rounded-999 bg-ink" /> : null}
              </span>
              <span className="flex-1">
                <span className={`${OPTION_TITLE} ${option.unsupported ? 'text-dim' : 'text-ink'}`}>
                  {option.title}
                </span>
                <span className={`${OPTION_DESCRIPTION} ${checked ? 'text-sub' : 'text-dim'}`}>
                  {option.description}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </SettingsSection>
  )
}
