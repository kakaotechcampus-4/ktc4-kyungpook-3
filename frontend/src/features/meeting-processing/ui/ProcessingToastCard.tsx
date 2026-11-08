import { useEffect, useRef } from 'react'
import type { Ref } from 'react'
import type { ProcessingStepState } from '@/entities/meeting'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import {
  PROCESSING_DONE_ACTION,
  PROCESSING_DONE_TITLE,
  PROCESSING_FAILED_TITLE,
  SPEAKERS_NEEDED_ACTION,
  SPEAKERS_NEEDED_TITLE,
} from '../model/notices'
import { signalAnnouncement } from '../model/processingSignal'
import type { ProcessingSignal } from '../model/processingSignal'

/* 비교 화면(#424) 값. 그림자·전환·스피너가 없다 — 깊이는 테두리 한 겹, 진행은 멈춘 줄무늬다 */
/* 독은 누름을 통과시킨다. 카드·알약 면만 누름을 받는다 */
const CARD =
  'pointer-events-auto flex w-[300px] max-w-[calc(100vw-48px)] flex-col gap-8 rounded-12 border px-14 py-12'
const NEUTRAL = 'border-line-strong bg-surface'
const ATTENTION = 'border-accent-chip bg-accent-badge'
const TOP = 'flex items-start justify-between gap-8'
const TITLE = 'flex min-w-0 items-center gap-7 text-body font-semibold'
/* 회의 이름은 파일 이름 기본값이라 띄어 쓰지 않은 긴 글자일 수 있다. 이름이 들어가는 자리는 줄을 바꿔 카드 안에 둔다 */
const SUB = 'text-caption text-sub wrap-anywhere'
const META = 'text-meta text-dim tabular-nums'
const FOOTER = 'flex items-center justify-between gap-8'
const ICON_BUTTON =
  '-mt-4 -mr-6 inline-flex size-26 shrink-0 items-center justify-center rounded-7 text-sub hover:bg-control'
const LINK = 'text-caption font-semibold text-ink underline underline-offset-3'
/* 먹 면 위 흰 포커스 선은 Button 의 주 버튼과 같다 */
const SPEAKERS_BUTTON =
  'inline-flex h-32 items-center justify-center rounded-9 bg-accent-solid px-12 text-[13px] font-semibold whitespace-nowrap text-surface hover:bg-accent focus-visible:outline-surface focus-visible:-outline-offset-3'
const PILL =
  'pointer-events-auto inline-flex h-34 items-center gap-8 rounded-999 bg-ink px-14 text-caption font-semibold text-surface focus-visible:outline-surface focus-visible:-outline-offset-3'

const SEGMENT: Record<ProcessingStepState, string> = {
  done: 'bg-ink',
  current:
    'bg-[repeating-linear-gradient(90deg,var(--color-ink)_0_6px,var(--color-line)_6px_10px)]',
  waiting: 'bg-line',
}

/** 「7일 안에」는 BE 의 화자 지정 만료(upload_sweeper, 대기 시작부터 7일)와 같다. 남은 날은 FE 가 시작 시각을 받지 않아 보이지 않는다 */
const SPEAKERS_DEADLINE = '7일 안에 정해 주세요'

export interface ProcessingToastCardProps {
  signal: ProcessingSignal
  /** 정리 중·화자 지정 필요에서 쓴다. 완료·실패는 늘 펼친다 */
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onOpenProcessing: () => void
  onAssignSpeakers: () => void
  onOpenMinutes: () => void
  onDismiss: () => void
}

/**
 * 회의 정리 진행 토스트 하나 (#424). 정리 중(펼침·접힘) → 화자 지정 필요 → 완료·실패를 같은 자리에서 바꿔 그린다.
 * 화면 읽기 프로그램 알림(role=status)은 모양 바깥에 하나 두어, 접고 펼쳐도 남고 단계가 바뀔 때만 문장이 바뀐다
 */
export function ProcessingToastCard({
  signal,
  collapsed,
  onCollapsedChange,
  ...actions
}: ProcessingToastCardProps) {
  // 이 카드에서 접거나 펼쳤을 때만 새로 그린 단추(알약·접기)로 포커스를 옮긴다 — 처음 그리거나 진행이 바뀔 때는 빼앗지 않는다
  const toggleButton = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    toggleButton.current?.focus()
  }, [collapsed])
  const toggle = (next: boolean) => {
    toggled.current = true
    onCollapsedChange(next)
  }
  // 알림 문장은 빈 알림 영역을 그린 뒤에 채운다. 처음부터 글이 든 채 생긴 알림 영역은 화면 읽기 프로그램이 읽지 않을 수 있다 —
  // 카드가 새로 생겨도(처리 화면을 떠났거나, 실패 판정을 기다리느라 잠깐 빠졌던 회의) 채워지는 변화로 읽힌다
  const announcement = signalAnnouncement(signal)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (status.current !== null) status.current.textContent = announcement
  }, [announcement])

  return (
    <div className="flex flex-col items-end">
      <p ref={status} role="status" className="sr-only" />
      {(signal.kind === 'processing' || signal.kind === 'speakers') && collapsed ? (
        <button
          type="button"
          ref={toggleButton}
          className={PILL}
          aria-expanded={false}
          onClick={() => toggle(false)}
        >
          <span aria-hidden="true" className="size-6 shrink-0 rounded-999 bg-accent-signal" />
          {signal.kind === 'processing' ? (
            <>
              정리 중
              {signal.steps === null ? null : (
                <span className="font-normal text-inactive tabular-nums">
                  {signal.doneCount}/{signal.steps.length}
                </span>
              )}
            </>
          ) : (
            SPEAKERS_NEEDED_TITLE
          )}
          <Icon name="chevron-up" size={14} />
          <span className="sr-only">펼치기</span>
        </button>
      ) : (
        <Card
          signal={signal}
          toggleButton={toggleButton}
          onCollapse={() => toggle(true)}
          {...actions}
        />
      )}
    </div>
  )
}

function Card({
  signal,
  toggleButton,
  onCollapse,
  onOpenProcessing,
  onAssignSpeakers,
  onOpenMinutes,
  onDismiss,
}: Omit<ProcessingToastCardProps, 'collapsed' | 'onCollapsedChange'> & {
  toggleButton: Ref<HTMLButtonElement>
  onCollapse: () => void
}) {
  switch (signal.kind) {
    case 'processing':
      return (
        <section aria-label={`${signal.title} 정리 중`} className={`${CARD} ${NEUTRAL}`}>
          <div className={TOP}>
            <p className={`${TITLE} text-ink`}>
              <span aria-hidden="true" className="size-6 shrink-0 rounded-999 bg-ink" />
              <span className="min-w-0 wrap-anywhere">{signal.title} 정리 중</span>
            </p>
            <CollapseButton toggleButton={toggleButton} onCollapse={onCollapse} />
          </div>
          <p className={SUB}>{signal.sentence}</p>
          {/* 칸 수는 회의 출처마다 다르다 — 녹음 셋, 채팅 둘. 출처를 모르면 칸·수를 그리지 않는다 (#483) */}
          {signal.steps === null ? null : (
            <div aria-hidden="true" className="grid auto-cols-fr grid-flow-col gap-4">
              {signal.steps.map((state, index) => (
                <span key={index} className={`h-5 rounded-999 ${SEGMENT[state]}`} />
              ))}
            </div>
          )}
          <div className={FOOTER}>
            <span className={META}>
              {signal.steps === null
                ? null
                : `${signal.doneCount} / ${signal.steps.length} 단계 완료`}
            </span>
            <button type="button" className={LINK} onClick={onOpenProcessing}>
              자세히 보기
            </button>
          </div>
        </section>
      )
    case 'speakers':
      return (
        <section aria-label={SPEAKERS_NEEDED_TITLE} className={`${CARD} ${ATTENTION}`}>
          <div className={TOP}>
            <p className={`${TITLE} text-accent`}>{SPEAKERS_NEEDED_TITLE}</p>
            <CollapseButton toggleButton={toggleButton} onCollapse={onCollapse} />
          </div>
          <p className={SUB}>{signal.title} · 누가 말했는지 정하면 정리가 이어져요</p>
          <div className={FOOTER}>
            <span className={META}>{SPEAKERS_DEADLINE}</span>
            <button type="button" className={SPEAKERS_BUTTON} onClick={onAssignSpeakers}>
              {SPEAKERS_NEEDED_ACTION}
            </button>
          </div>
        </section>
      )
    case 'done':
      return (
        <section aria-label={PROCESSING_DONE_TITLE} className={`${CARD} ${NEUTRAL}`}>
          <div className={TOP}>
            <p className={`${TITLE} text-ink`}>{PROCESSING_DONE_TITLE}</p>
            <DismissButton onDismiss={onDismiss} />
          </div>
          <p className={SUB}>{signal.title}</p>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={onOpenMinutes}>
              {PROCESSING_DONE_ACTION}
            </Button>
          </div>
        </section>
      )
    case 'failed':
      return (
        <section aria-label={PROCESSING_FAILED_TITLE} className={`${CARD} ${NEUTRAL}`}>
          <div className={TOP}>
            <p className={`${TITLE} text-ink`}>{PROCESSING_FAILED_TITLE}</p>
            <DismissButton onDismiss={onDismiss} />
          </div>
          <p className={SUB}>
            {signal.title} · {signal.description}
          </p>
        </section>
      )
  }
}

function CollapseButton({
  toggleButton,
  onCollapse,
}: {
  toggleButton: Ref<HTMLButtonElement>
  onCollapse: () => void
}) {
  return (
    <button
      type="button"
      ref={toggleButton}
      className={ICON_BUTTON}
      aria-label="접기"
      aria-expanded={true}
      onClick={onCollapse}
    >
      <Icon name="chevron-down" size={14} />
    </button>
  )
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button type="button" className={ICON_BUTTON} aria-label="닫기" onClick={onDismiss}>
      <Icon name="close" size={14} />
    </button>
  )
}
