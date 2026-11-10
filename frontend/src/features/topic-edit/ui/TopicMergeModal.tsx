import { useId, useState } from 'react'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import type { SelectOption } from '@/shared/ui/select'
import { EditConfirm } from './EditConfirm'
import { FIELD } from './styles'

export interface TopicMergeModalProps {
  /** 이 주제 말고 합칠 수 있는 주제 */
  targets: readonly SelectOption<string>[]
  /** 이름이 겹쳐 권한 주제처럼 미리 고른 대상 */
  initialTarget: string | null
  pending: boolean
  failure: string | null
  onConfirm: (intoTopicId: string) => void
  onCancel: () => void
}

/** 이 주제를 고른 주제에 합친다. 이 주제는 사라지고 되돌릴 수 없다 */
export function TopicMergeModal({
  targets,
  initialTarget,
  pending,
  failure,
  onConfirm,
  onCancel,
}: TopicMergeModalProps) {
  const [target, setTarget] = useState<string | null>(initialTarget)
  const labelId = useId()
  return (
    <EditConfirm
      title="다른 주제와 합칠까요?"
      description="이 주제의 결정·태스크·회의가 고른 주제로 옮겨 가고 이 주제는 사라져요. 이 주제의 이름은 고른 주제의 다른 이름으로 남아요. 되돌릴 수 없어요."
      confirmLabel="합치기"
      pending={pending}
      failure={failure}
      confirmDisabled={target === null}
      onConfirm={() => {
        if (target !== null) onConfirm(target)
      }}
      onCancel={onCancel}
    >
      <div className={FIELD}>
        <Label id={labelId}>합칠 주제</Label>
        <Select
          label="합칠 주제"
          aria-labelledby={labelId}
          value={target}
          onValueChange={setTarget}
          options={targets}
          placeholder="주제를 골라 주세요"
          disabled={pending}
        />
      </div>
    </EditConfirm>
  )
}
