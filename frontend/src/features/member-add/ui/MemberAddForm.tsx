import { useId, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { TextField } from '@/shared/ui/text-field'
import { useMemberAdd } from '../model/useMemberAdd'

/* 서버가 101자부터 400 으로 거절한다 */
const NAME_MAX = 100

/* 라벨과 칸 사이 간격은 TextField 의 화면군 간격(제품 6 · 온보딩 7)과 같다 */
const LABEL_GAP = { product: 'mb-6', onboarding: 'mb-7' } as const

const ADDED = 'flex flex-col pt-10'

/* 띄어 쓰지 않은 긴 이름도 줄 안에서 접는다 — 좁은 카드·창에서 가로로 넘치지 않는다 */
const ADDED_ROW =
  'border-b border-surface-selected py-8 text-body wrap-anywhere text-ink last:border-b-0'

export interface MemberAddFormProps {
  workspaceId: string
  /** 칸 모양. 온보딩 카드는 `onboarding`, 팀 화면의 팀원 연결 창은 `product` 다. 기본 `product` */
  tone?: 'product' | 'onboarding'
}

/**
 * Discord 를 연결하지 않은 팀이 이름만으로 팀원을 추가한다 (#613). 아래에 PM 이 아닌 팀원을 보인다.
 * 라벨을 칸 밖에 두어 칸과 `추가` 버튼이 한 줄에서 같은 높이로 선다
 */
export function MemberAddForm({ workspaceId, tone = 'product' }: MemberAddFormProps) {
  const { list, members, adding, feedback, clearFeedback, add } = useMemberAdd(workspaceId)
  const [text, setText] = useState('')
  const fieldId = useId()
  const added = members.filter(({ role }) => role !== 'pm')

  return (
    <div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          add(text, () => setText(''))
        }}
      >
        <Label htmlFor={fieldId} tone={tone} className={LABEL_GAP[tone]}>
          팀원 이름
        </Label>
        <div className="flex items-start gap-8">
          <TextField
            id={fieldId}
            tone={tone}
            className="min-w-[0px] flex-1"
            placeholder="이름"
            autoComplete="off"
            maxLength={NAME_MAX}
            // 보내는 동안 고친 글자를 성공 뒤 비우기가 지우지 않게, 포커스는 두되 고칠 수 없게 한다
            readOnly={adding}
            value={text}
            onKeyDown={(event) => {
              // 한글 조합을 확정하는 Enter 는 입력기 몫이다. Safari 는 그 Enter 를 keyCode 229 로만 보낸다
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                event.preventDefault()
            }}
            onChange={(event) => {
              setText(event.target.value)
              clearFeedback()
            }}
            error={feedback ?? undefined}
          />
          {/* 입력 칸(42px)과 높이를 맞춘다 */}
          <Button
            type="submit"
            size={tone === 'onboarding' ? 'lg-onboarding' : 'lg'}
            className="min-h-[42px] shrink-0"
            disabled={list.status !== 'ready' || text.trim() === ''}
            loading={adding}
          >
            추가
          </Button>
        </div>
      </form>
      {/* 폼 밖에 둔다 — 폼 안의 버튼은 제출이다 */}
      {list.status === 'error' ? (
        <div className="pt-10">
          <QueryErrorState error={list.error} onRetry={list.retry} />
        </div>
      ) : null}
      {added.length > 0 ? (
        <ul aria-label="추가한 팀원" className={ADDED}>
          {added.map((member) => (
            <li key={member.id} className={ADDED_ROW}>
              {member.displayName}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
