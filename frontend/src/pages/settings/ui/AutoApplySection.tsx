import { useState } from 'react'
import { RadioCardGroup } from './RadioCardGroup'
import type { RadioCardOption } from './RadioCardGroup'
import { SettingsSection } from './SettingsSection'

type AutoApplyPolicy = 'review_all' | 'clear_only' | 'apply_all'

/* 문구는 Settings 캔버스 그대로다 */
const OPTIONS: readonly RadioCardOption<AutoApplyPolicy>[] = [
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
  return (
    <SettingsSection
      id="settings-auto-apply"
      title="자동 반영 기준"
      description="어디까지를 사람이 보지 않고 Notion에 올릴지 정합니다. 무엇을 올리든 로그에 남고 되돌릴 수 있어요."
    >
      <RadioCardGroup
        labelledBy="settings-auto-apply-title"
        options={OPTIONS}
        value={policy}
        onChange={setPolicy}
        disabled={!canManage}
      />
    </SettingsSection>
  )
}
