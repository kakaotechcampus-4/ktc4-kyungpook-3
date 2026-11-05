import { useId, useState } from 'react'
import { speakerTitle, speakingTime } from '@/entities/meeting'
import type { SpeakerCandidate, SpeakerLabel } from '@/entities/meeting'
import { Button } from '@/shared/ui/button'
import type { SpeakerChoice } from '../model/assignmentDraft'
import type { SamplePlayer } from '../model/useSamplePlayer'

/* 카드는 흰 면 + 1px 선(디자인 §0-4). 선택 카드와 같은 라운드·여백이다 (SelectCard) */
const CARD = 'flex flex-col gap-14 rounded-16 border border-line bg-surface px-18 py-16'
const TITLE = 'text-body font-semibold text-ink'
const META = 'text-caption text-dim tabular-nums'
const NOTE = 'text-caption text-dim'
const OPTION = 'flex items-center gap-8 text-body text-ink'
const HINT = 'text-caption text-dim'
const GROUP_LABEL = 'text-caption font-semibold text-sub'
const EXTERNAL = 'external'

/** 샘플 시작 위치. 회의 녹음 안의 분:초다 */
function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export interface SpeakerCardProps {
  index: number
  speaker: SpeakerLabel
  candidates: readonly SpeakerCandidate[]
  /** 참석자 밖의 워크스페이스 팀원. 펼쳐야 보인다 */
  others: readonly SpeakerCandidate[]
  choice: SpeakerChoice | undefined
  onChoose: (choice: SpeakerChoice) => void
  /** 이 팀원을 고른 다른 화자의 이름. 없으면 빈 목록 */
  chosenElsewhere: (memberId: string) => string[]
  /** 녹음이 없으면 null — 재생 버튼을 그리지 않는다 */
  player: SamplePlayer | null
}

/** 화자 라벨 하나. 샘플을 들어 보고 팀원·외부 참석자 중 하나를 고른다 */
export function SpeakerCard({
  index,
  speaker,
  candidates,
  others,
  choice,
  onChoose,
  chosenElsewhere,
  player,
}: SpeakerCardProps) {
  const title = speakerTitle(index)
  const headingId = useId()
  const othersId = useId()
  const [othersOpen, setOthersOpen] = useState(false)
  const name = `speaker-${speaker.label}`
  const chosenMember = choice?.kind === 'member' ? choice.memberId : null
  // 고른 다른 팀원이 접혀 숨지 않게 연다
  const showOthers = othersOpen || others.some(({ memberId }) => memberId === chosenMember)

  const memberOption = (member: SpeakerCandidate) => {
    const elsewhere = chosenElsewhere(member.memberId)
    return (
      <label key={member.memberId} className={OPTION}>
        <input
          type="radio"
          name={name}
          value={member.memberId}
          checked={chosenMember === member.memberId}
          onChange={() => onChoose({ kind: 'member', memberId: member.memberId })}
        />
        {member.displayName}
        {elsewhere.length === 0 ? null : (
          <span className={HINT}>{`이미 ${elsewhere.join(', ')}에 지정됨`}</span>
        )}
      </label>
    )
  }

  return (
    <section aria-labelledby={headingId} className={CARD}>
      <div className="flex flex-col gap-4">
        <h2 id={headingId} className={TITLE}>
          {title}
        </h2>
        <p className={META}>{`총 ${speakingTime(speaker.totalSec)} 말함`}</p>
      </div>
      {player === null ? null : speaker.samples.length === 0 ? (
        <p className={NOTE}>들어 볼 구간이 없어요.</p>
      ) : (
        <ul aria-label={`${title} 샘플`} className="flex flex-wrap gap-8">
          {speaker.samples.map((sample, sampleIndex) => {
            const key = { label: speaker.label, index: sampleIndex }
            const playing = player.isPlaying(key)
            return (
              <li key={sampleIndex}>
                <Button
                  type="button"
                  size="sm"
                  aria-pressed={playing}
                  aria-label={`${title} 샘플 ${sampleIndex + 1} ${playing ? '멈추기' : '듣기'}`}
                  disabled={player.failed}
                  onClick={() => player.toggle(key, sample)}
                >
                  {playing
                    ? '멈추기'
                    : `샘플 ${sampleIndex + 1} · ${clock(sample.start)} · ${speakingTime(sample.end - sample.start)}`}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <fieldset className="flex flex-col gap-8">
        <legend className="sr-only">{`${title} 지정`}</legend>
        {candidates.length === 0 ? null : (
          <>
            <p className={GROUP_LABEL} aria-hidden="true">
              참석자
            </p>
            {candidates.map(memberOption)}
          </>
        )}
        {others.length === 0 ? null : (
          <>
            <button
              type="button"
              aria-expanded={showOthers}
              aria-controls={othersId}
              className="self-start text-caption font-semibold text-sub underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setOthersOpen((open) => !open)}
            >
              {`다른 팀원 ${others.length}명 ${showOthers ? '접기' : '보기'}`}
            </button>
            <div id={othersId} hidden={!showOthers} className="flex flex-col gap-8">
              {showOthers ? others.map(memberOption) : null}
            </div>
          </>
        )}
        <label className={OPTION}>
          <input
            type="radio"
            name={name}
            value={EXTERNAL}
            checked={choice?.kind === 'external'}
            onChange={() => onChoose({ kind: 'external' })}
          />
          외부 참석자
          <span className={HINT}>팀원이 아닌 사람</span>
        </label>
      </fieldset>
    </section>
  )
}
