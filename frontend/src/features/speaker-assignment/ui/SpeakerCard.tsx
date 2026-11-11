import { useId, useState } from 'react'
import { speakerTitle, speakingTime } from '@/entities/meeting'
import type { SpeakerCandidate, SpeakerLabel } from '@/entities/meeting'
import { Icon } from '@/shared/ui/icon'
import type { SpeakerChoice } from '../model/assignmentDraft'
import type { SamplePlayer } from '../model/useSamplePlayer'

const CARD = 'flex flex-col gap-20 rounded-16 border bg-surface px-30 py-28 max-sm:px-18'
const TITLE = 'text-[19px] leading-[29px] font-bold tracking-[-0.475px] text-ink'
const META = 'text-[12px] leading-[21px] whitespace-nowrap text-dim tabular-nums'
const NOTE = 'text-caption text-dim'
const OPTION =
  'relative inline-flex min-h-[42px] cursor-pointer items-center gap-9 rounded-9 border py-7 pr-14 pl-9 text-[14px] leading-none font-semibold has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink has-[input:focus-visible]:outline-offset-4'
const RADIO = 'absolute inset-0 h-full w-full cursor-pointer opacity-0'
const AVATAR =
  'inline-flex size-26 shrink-0 items-center justify-center rounded-999 text-[10px] leading-none font-semibold text-ink'
const HINT = 'text-[12px] leading-[1.4] font-normal text-dim'
const GROUP_LABEL = 'text-[12.5px] leading-[18px] font-semibold text-sub'
const SAMPLE_BUTTON =
  'inline-flex h-[38px] items-center gap-9 rounded-9 border border-line bg-surface pr-14 pl-8 text-[13px] leading-none font-semibold whitespace-nowrap text-ink hover:bg-control disabled:cursor-not-allowed disabled:text-faint'
const EXTERNAL = 'external'

function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export interface SpeakerCardProps {
  index: number
  speaker: SpeakerLabel
  candidates: readonly SpeakerCandidate[]
  others: readonly SpeakerCandidate[]
  choice: SpeakerChoice | undefined
  onChoose: (choice: SpeakerChoice) => void
  chosenElsewhere: (memberId: string) => string[]
  player: SamplePlayer | null
}

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
  const selectedMember = [...candidates, ...others].find(
    ({ memberId }) => memberId === chosenMember,
  )
  const showOthers = othersOpen || others.some(({ memberId }) => memberId === chosenMember)

  const memberOption = (member: SpeakerCandidate) => {
    const elsewhere = chosenElsewhere(member.memberId)
    const selected = chosenMember === member.memberId
    return (
      <label
        key={member.memberId}
        className={`${OPTION} ${selected ? 'border-ink-solid bg-ink-solid text-surface' : 'border-line bg-surface text-ink hover:bg-surface-sunken'}`}
      >
        <input
          className={RADIO}
          type="radio"
          name={name}
          value={member.memberId}
          checked={selected}
          onChange={() => onChoose({ kind: 'member', memberId: member.memberId })}
        />
        <span aria-hidden="true" className={`${AVATAR} ${selected ? 'bg-surface' : 'bg-divider'}`}>
          {member.displayName.slice(-2)}
        </span>
        {member.displayName}
        {selected ? <Icon name="check" size={14} /> : null}
        {elsewhere.length === 0 ? null : (
          <span className={selected ? 'text-[12px] leading-[1.4] font-normal text-surface' : HINT}>
            {`이미 ${elsewhere.join(', ')}에 지정됨`}
          </span>
        )}
      </label>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`${CARD} ${choice === undefined ? 'border-line-strong shadow-[0_8px_24px_0_rgba(51,51,51,0.2)]' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-14">
        <span
          aria-hidden="true"
          className={`inline-flex size-40 shrink-0 items-center justify-center rounded-999 text-[16px] leading-none font-semibold ${selectedMember === undefined ? 'border border-dashed border-[var(--color-dashed)] text-dim' : 'bg-divider text-ink'}`}
        >
          {selectedMember?.displayName.slice(-2) ?? '?'}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-11">
          <h2 id={headingId} className={TITLE}>
            {title}
          </h2>
          {choice === undefined ? (
            <span className="inline-flex h-22 items-center gap-5 rounded-6 bg-ink-solid px-9 text-[11.5px] leading-none font-semibold whitespace-nowrap text-surface">
              <span aria-hidden="true" className="mr-3 size-5 shrink-0 rounded-999 bg-surface" />
              고르지 않음
            </span>
          ) : (
            <span className="inline-flex h-22 items-center rounded-6 bg-control px-8 text-[11.5px] leading-none font-semibold whitespace-nowrap text-sub">
              {choice.kind === 'external'
                ? '외부 참석자로 지정'
                : `${selectedMember?.displayName ?? '팀원'}으로 지정`}
            </span>
          )}
        </div>
        <p className={META}>{`총 ${speakingTime(speaker.totalSec)} 말함`}</p>
      </div>
      {player === null ? null : speaker.samples.length === 0 ? (
        <p className={NOTE}>들어 볼 구간이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-10 rounded-12 bg-surface-sunken px-18 py-16">
          <p className="text-[11.5px] leading-[18px] font-semibold text-dim">샘플 듣기</p>
          <ul aria-label={`${title} 샘플`} className="flex flex-wrap gap-8">
            {speaker.samples.map((sample, sampleIndex) => {
              const key = { label: speaker.label, index: sampleIndex }
              const playing = player.isPlaying(key)
              return (
                <li key={sampleIndex}>
                  <button
                    type="button"
                    className={SAMPLE_BUTTON}
                    aria-pressed={playing}
                    aria-label={`${title} 샘플 ${sampleIndex + 1} ${playing ? '멈추기' : '듣기'}`}
                    disabled={player.failed}
                    onClick={() => player.toggle(key, sample)}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex size-22 shrink-0 items-center justify-center rounded-999 bg-ink-solid"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="text-surface"
                      >
                        {playing ? (
                          <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                        ) : (
                          <path d="M7 4.5v15l13-7.5z" />
                        )}
                      </svg>
                    </span>
                    {playing ? '멈추기' : `샘플 ${sampleIndex + 1}`}
                    <span className="font-normal text-dim tabular-nums">
                      {`${clock(sample.start)} · ${speakingTime(sample.end - sample.start)}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <fieldset className="flex min-w-0 flex-col gap-10">
        <legend className="sr-only">{`${title} 지정`}</legend>
        <p className={GROUP_LABEL} aria-hidden="true">
          참석자
        </p>
        <div className="flex flex-wrap items-start gap-8">
          {candidates.map(memberOption)}
          {others.length === 0 ? null : (
            <>
              <button
                type="button"
                aria-expanded={showOthers}
                aria-controls={othersId}
                className="inline-flex h-[42px] items-center gap-6 rounded-9 border border-dashed border-[var(--color-dashed)] px-14 text-[13px] leading-none font-semibold text-sub hover:bg-surface-sunken hover:text-ink"
                onClick={() => setOthersOpen((open) => !open)}
              >
                {`다른 팀원 ${others.length}명 ${showOthers ? '접기' : '보기'}`}
                <Icon
                  name={showOthers ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  className="text-dim"
                />
              </button>
              <div id={othersId} hidden={!showOthers} className="flex flex-wrap gap-8">
                {showOthers ? others.map(memberOption) : null}
              </div>
            </>
          )}
          <label
            className={`${OPTION} ${choice?.kind === 'external' ? 'border-ink-solid bg-ink-solid text-surface' : 'border-dashed border-[var(--color-dashed)] text-ink hover:bg-surface-sunken'}`}
          >
            <input
              className={RADIO}
              type="radio"
              name={name}
              value={EXTERNAL}
              checked={choice?.kind === 'external'}
              onChange={() => onChoose({ kind: 'external' })}
            />
            <span
              aria-hidden="true"
              className={`${AVATAR} ${choice?.kind === 'external' ? 'bg-surface' : 'border border-dashed border-[var(--color-dashed)] text-dim'}`}
            >
              ?
            </span>
            외부 참석자
            <span
              className={
                choice?.kind === 'external'
                  ? 'text-[12px] leading-[1.4] font-normal text-surface'
                  : HINT
              }
            >
              팀원이 아닌 사람
            </span>
          </label>
        </div>
      </fieldset>
    </section>
  )
}
