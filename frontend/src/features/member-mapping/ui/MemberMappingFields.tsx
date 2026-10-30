import { useId } from 'react'
import { useController } from 'react-hook-form'
import type { Control } from 'react-hook-form'
import type { Member } from '@/entities/member'
import { Checkbox } from '@/shared/ui/checkbox'
import { ErrorText } from '@/shared/ui/error-text'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { TextField } from '@/shared/ui/text-field'
import type { MappingFormValues, MemberMappingForm } from '../model/useMemberMappingForm'

const ROW = 'flex items-start gap-10 border-b border-surface-selected py-10 last:border-b-0'

/* 아이디와 PM 라벨의 한 줄. 아이디만 말줄임하고 라벨은 잘리지 않는다 */
const HANDLE = 'flex min-w-[0px] flex-1 items-center gap-6 pt-12'

const HANDLE_TEXT = 'min-w-[0px] truncate text-caption text-dim tabular-nums'

/* PM 을 체크한 줄의 라벨. 회의록 상태 배지(MeetingMinutes STATUS_BADGE)와 같은 모양이다 */
const PM_LABEL =
  'inline-flex h-18 shrink-0 items-center rounded-6 bg-control px-6 text-[10.5px] leading-none font-semibold text-sub'

const FIELDS = 'flex min-w-[0px] flex-1 flex-col gap-6'

/* 줄 맨 앞의 PM 체크. 체크 칸(18px)의 가운데를 이름 칸(42px)의 가운데에 맞춘다 — 9 + 체크 줄 위 여백 3 + 9 = 21 */
const PM_CHECK = 'shrink-0 pt-9'

/** PM 의 디스코드 계정을 골라 체크해 달라고 목록 위에 한 줄로 알린다 */
const PM_HINT = 'pt-6 text-caption text-dim'

interface PmCheckProps {
  control: Control<MappingFormValues>
  index: number
  username: string
  /** 체크하면 이을 PM. 워크스페이스를 만든 PM 이다 */
  pm: Member
  /** 다른 줄에서 이미 그 PM 을 체크했다. 이 줄에서는 체크할 수 없다 */
  takenElsewhere: boolean
  errorId: string | undefined
}

/**
 * 이 Discord 사용자가 PM 인지 체크한다 (#228). 체크하면 그 PM 의 id 가 이 줄의 값이 되고, 풀면 null 이다.
 * 오류 문구는 이름 칸 아래에 있다 — `errorId` 로 잇는다
 */
function PmCheck({ control, index, username, pm, takenElsewhere, errorId }: PmCheckProps) {
  const {
    field: { ref, value, onChange, onBlur },
  } = useController({ control, name: `rows.${index}.pmMemberId` })
  const checked = value !== null
  return (
    <div className={PM_CHECK}>
      <Checkbox
        ref={ref}
        checked={checked}
        disabled={!checked && takenElsewhere}
        aria-label={`@${username} — PM ${pm.displayName}`}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        onCheckedChange={(next) => onChange(next === true ? pm.id : null)}
        onBlur={onBlur}
      />
    </div>
  )
}

export interface MemberMappingFieldsProps {
  mapping: MemberMappingForm
}

/**
 * 팀원 연결 입력의 본문 — 폼 오류, PM 안내, 줄 목록. `<form>` 과 버튼은 담는 화면이 둔다.
 * PM 을 체크한 줄은 이름 칸을 PM 이름으로 잠근다 (#228).
 */
export function MemberMappingFields({ mapping }: MemberMappingFieldsProps) {
  const { form, initialRows, pms, rows, formError } = mapping
  const {
    register,
    control,
    formState: { errors },
  } = form
  const fieldId = useId()
  const creator = pms[0]

  return (
    <>
      <FormErrorPanel message={formError} className="mt-6" />
      {initialRows.length === 0 ? (
        <p className="pt-6 text-body text-dim">디스코드 서버에서 팀원을 찾지 못했어요.</p>
      ) : (
        <>
          {creator ? (
            <p className={PM_HINT}>
              PM {creator.displayName}님의 디스코드 계정을 찾아 체크해 주세요. 이름이 달라도 PM으로
              연결돼요.
            </p>
          ) : null}
          <ul className="pt-6">
            {initialRows.map((row, index) => {
              const pmMemberId = rows[index]?.pmMemberId ?? null
              const picked = pms.find(({ id }) => id === pmMemberId)
              const pmError = errors.rows?.[index]?.pmMemberId?.message
              const pmErrorId = pmError ? `${fieldId}-${index}-pm-error` : undefined
              return (
                <li key={row.discordUserId} className={ROW}>
                  {creator ? (
                    <PmCheck
                      control={control}
                      index={index}
                      username={row.username}
                      pm={creator}
                      takenElsewhere={rows.some(
                        (other, otherIndex) =>
                          otherIndex !== index && other.pmMemberId === creator.id,
                      )}
                      errorId={pmErrorId}
                    />
                  ) : null}
                  <span className={HANDLE}>
                    <span className={HANDLE_TEXT}>@{row.username}</span>
                    {pmMemberId === null ? null : <span className={PM_LABEL}>PM</span>}
                  </span>
                  <Icon name="arrow-right" size={12} className="mt-15 shrink-0 text-dashed" />
                  <div className={FIELDS}>
                    {/* PM 을 체크한 줄은 이름을 보지 않는다. 적어 둔 이름은 남겨 두고 PM 이름을 잠가 보인다 */}
                    {pmMemberId === null ? (
                      <TextField
                        key="name"
                        tone="onboarding"
                        aria-label={`@${row.username}의 팀원 이름`}
                        placeholder="누구인가요?"
                        error={errors.rows?.[index]?.name?.message}
                        {...register(`rows.${index}.name`)}
                      />
                    ) : (
                      <TextField
                        key="pm"
                        tone="onboarding"
                        aria-label={`@${row.username}의 팀원 이름`}
                        value={picked?.displayName ?? ''}
                        disabled
                      />
                    )}
                    {pmError ? <ErrorText id={pmErrorId}>{pmError}</ErrorText> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
