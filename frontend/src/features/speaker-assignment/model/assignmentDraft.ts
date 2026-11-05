import type { SpeakerLabel } from '@/entities/meeting'

/** 라벨 하나에 고른 것. 외부 참석자도 직접 고른 선택이다 */
export type SpeakerChoice = { kind: 'member'; memberId: string } | { kind: 'external' }
/** 라벨 → 고른 것. 키가 없으면 아직 고르지 않았다 */
export type SpeakerChoices = Readonly<Record<string, SpeakerChoice>>

export type AssignmentDraft =
  { ready: true; mapping: Record<string, string | null> } | { ready: false; remaining: number }

/**
 * 제출할 수 있는지와 보낼 지정. 모든 라벨을 직접 골라야 한다. 외부 참석자는 null 로 보낸다 (계약 §2.3.1).
 * 지금 라벨에 없는 키는 보내지 않는다 — 라벨이 바뀌어 다시 받았을 때 남은 선택이 400 을 만들지 않는다
 */
export function assignmentDraft(
  speakers: readonly SpeakerLabel[],
  choices: SpeakerChoices,
): AssignmentDraft {
  const remaining = speakers.filter(({ label }) => !Object.hasOwn(choices, label)).length
  if (remaining > 0) return { ready: false, remaining }
  return {
    ready: true,
    mapping: Object.fromEntries(
      speakers.map(({ label }) => {
        const choice = choices[label]
        return [label, choice.kind === 'member' ? choice.memberId : null]
      }),
    ),
  }
}

/** 이 팀원을 고른 다른 라벨의 순서(0부터). 같은 팀원을 여러 라벨에 지정해도 되고, 화면은 알려만 준다 */
export function chosenElsewhere(
  speakers: readonly SpeakerLabel[],
  choices: SpeakerChoices,
  label: string,
  memberId: string,
): number[] {
  return speakers.flatMap((speaker, index) => {
    const choice = choices[speaker.label]
    return speaker.label !== label && choice?.kind === 'member' && choice.memberId === memberId
      ? [index]
      : []
  })
}

/** 탈퇴한 팀원을 고른 선택만 지운다. 나머지 선택은 그대로다 */
export function withoutMembers(
  choices: SpeakerChoices,
  memberIds: readonly string[],
): SpeakerChoices {
  return Object.fromEntries(
    Object.entries(choices).filter(
      ([, choice]) => choice.kind !== 'member' || !memberIds.includes(choice.memberId),
    ),
  )
}
