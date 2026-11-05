import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { meetingAudioUrl, speakerTitle } from '@/entities/meeting'
import type { SpeakerCandidate, SpeakerView } from '@/entities/meeting'
import type { Member } from '@/entities/member'
import { Button } from '@/shared/ui/button'
import { assignmentDraft, chosenElsewhere, withoutMembers } from '../model/assignmentDraft'
import type { SpeakerChoice, SpeakerChoices } from '../model/assignmentDraft'
import type { SubmitRejection } from '../model/submitRejection'
import { useSamplePlayer } from '../model/useSamplePlayer'
import type { SpeakerSubmit } from '../model/useSpeakerSubmit'
import { SpeakerCard } from './SpeakerCard'

const NOTE = 'text-caption text-dim'
const ALERT = 'rounded-10 bg-surface-sunken px-14 py-12 text-body text-ink'
const REMAINING = 'text-caption font-semibold text-ink tabular-nums'

const REJECTION_TEXT: Record<
  Exclude<SubmitRejection['kind'], 'expired' | 'alreadyMoved'>,
  string
> = {
  labelsChanged: '화자 목록이 바뀌어 다시 불러왔어요. 화자마다 다시 확인한 뒤 제출해 주세요.',
  inactiveMembers: '워크스페이스를 나간 팀원이 있어 그 선택을 지웠어요. 다시 골라 주세요.',
  forbidden: 'PM만 화자를 지정할 수 있어요.',
  notFound: '회의를 찾을 수 없어요.',
  network: '네트워크에 연결할 수 없어 제출하지 못했어요. 연결을 확인한 뒤 다시 제출해 주세요.',
  unknown: '제출하지 못했어요. 잠시 후 다시 제출해 주세요.',
}

export interface SpeakerAssignmentFormProps {
  meetingId: string
  view: SpeakerView
  /** 워크스페이스 팀원. 참석자 밖의 팀원을 「다른 팀원」으로 보인다. 아직 없으면 그 묶음을 그리지 않는다 */
  members: readonly Member[] | undefined
  submission: SpeakerSubmit
}

export function SpeakerAssignmentForm({
  meetingId,
  view,
  members,
  submission,
}: SpeakerAssignmentFormProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const player = useSamplePlayer(audioRef)
  const remainingId = useId()
  const [choices, setChoices] = useState<SpeakerChoices>({})
  const draft = assignmentDraft(view.speakers, choices)
  const candidateIds = new Set(view.candidates.map(({ memberId }) => memberId))
  const others: SpeakerCandidate[] = (members ?? [])
    .filter(({ id }) => !candidateIds.has(id))
    .map(({ id, displayName }) => ({ memberId: id, displayName }))
  const rejectionText =
    submission.rejection === null ||
    submission.rejection.kind === 'expired' ||
    submission.rejection.kind === 'alreadyMoved'
      ? undefined
      : REJECTION_TEXT[submission.rejection.kind]

  const choose = (label: string, choice: SpeakerChoice) =>
    setChoices((current) => ({ ...current, [label]: choice }))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.ready || submission.pending) return
    const reason = await submission.submit(draft.mapping)
    if (reason?.kind === 'inactiveMembers')
      setChoices((current) => withoutMembers(current, reason.memberIds))
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-20" noValidate>
      {view.audio === null ? (
        <p className={NOTE}>
          녹음이 남아 있지 않아 샘플을 들을 수 없어요. 회의 내용을 떠올려 골라 주세요.
        </p>
      ) : (
        <>
          {/* 목소리로 화자를 가리는 원본이라 자막이 없다. 화면에 컨트롤을 보이지 않고 샘플 버튼이 조작한다 */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={audioRef} preload="metadata" src={meetingAudioUrl(meetingId)} />
          {player.failed ? (
            <p className={NOTE} role="status">
              녹음을 불러오지 못했어요. 샘플 없이 골라도 돼요.
            </p>
          ) : null}
        </>
      )}
      <div className="flex flex-col gap-12">
        {view.speakers.map((speaker, index) => (
          <SpeakerCard
            key={speaker.label}
            index={index}
            speaker={speaker}
            candidates={view.candidates}
            others={others}
            choice={choices[speaker.label]}
            onChoose={(choice) => choose(speaker.label, choice)}
            chosenElsewhere={(memberId) =>
              chosenElsewhere(view.speakers, choices, speaker.label, memberId).map(speakerTitle)
            }
            player={view.audio === null ? null : player}
          />
        ))}
      </div>
      {rejectionText === undefined ? null : (
        <p role="alert" className={ALERT}>
          {rejectionText}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-14">
        {draft.ready ? null : (
          <p id={remainingId} className={REMAINING}>
            {`아직 고르지 않은 화자 ${draft.remaining}명`}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!draft.ready}
          loading={submission.pending}
          aria-describedby={draft.ready ? undefined : remainingId}
        >
          지정하고 정리 이어 가기
        </Button>
      </div>
    </form>
  )
}
