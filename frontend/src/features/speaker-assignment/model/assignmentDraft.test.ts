import type { SpeakerLabel } from '@/entities/meeting'
import { assignmentDraft, chosenElsewhere, withoutMembers } from './assignmentDraft'
import type { SpeakerChoices } from './assignmentDraft'

const speakers: SpeakerLabel[] = ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'].map((label) => ({
  label,
  totalSec: 10,
  samples: [],
}))

describe('assignmentDraft', () => {
  it('고르지 않은 라벨이 있으면 제출할 수 없고 남은 수를 센다', () => {
    expect(assignmentDraft(speakers, {})).toEqual({ ready: false, remaining: 3 })
    expect(
      assignmentDraft(speakers, {
        SPEAKER_00: { kind: 'member', memberId: 'mb_01' },
        SPEAKER_02: { kind: 'external' },
      }),
    ).toEqual({ ready: false, remaining: 1 })
  })

  it('모두 고르면 라벨마다 팀원 ID, 외부 참석자는 null 로 보낸다. 같은 팀원을 여러 라벨에 골라도 된다', () => {
    expect(
      assignmentDraft(speakers, {
        SPEAKER_00: { kind: 'member', memberId: 'mb_01' },
        SPEAKER_01: { kind: 'member', memberId: 'mb_01' },
        SPEAKER_02: { kind: 'external' },
      }),
    ).toEqual({
      ready: true,
      mapping: { SPEAKER_00: 'mb_01', SPEAKER_01: 'mb_01', SPEAKER_02: null },
    })
  })

  it('지금 라벨에 없는 선택은 보내지 않는다', () => {
    expect(
      assignmentDraft(speakers.slice(0, 1), {
        SPEAKER_00: { kind: 'external' },
        SPEAKER_09: { kind: 'member', memberId: 'mb_02' },
      }),
    ).toEqual({ ready: true, mapping: { SPEAKER_00: null } })
  })

  it('라벨이 없으면 남은 것이 없어 보낼 수 있다', () => {
    expect(assignmentDraft([], {})).toEqual({ ready: true, mapping: {} })
  })
})

it('같은 팀원을 고른 다른 라벨을 찾는다', () => {
  const choices: SpeakerChoices = {
    SPEAKER_00: { kind: 'member', memberId: 'mb_01' },
    SPEAKER_01: { kind: 'external' },
    SPEAKER_02: { kind: 'member', memberId: 'mb_01' },
  }
  expect(chosenElsewhere(speakers, choices, 'SPEAKER_01', 'mb_01')).toEqual([0, 2])
  expect(chosenElsewhere(speakers, choices, 'SPEAKER_00', 'mb_01')).toEqual([2])
  expect(chosenElsewhere(speakers, choices, 'SPEAKER_00', 'mb_02')).toEqual([])
})

it('탈퇴한 팀원의 선택만 지운다', () => {
  expect(
    withoutMembers(
      {
        SPEAKER_00: { kind: 'member', memberId: 'mb_01' },
        SPEAKER_01: { kind: 'member', memberId: 'mb_04' },
        SPEAKER_02: { kind: 'external' },
      },
      ['mb_04'],
    ),
  ).toEqual({ SPEAKER_00: { kind: 'member', memberId: 'mb_01' }, SPEAKER_02: { kind: 'external' } })
})
