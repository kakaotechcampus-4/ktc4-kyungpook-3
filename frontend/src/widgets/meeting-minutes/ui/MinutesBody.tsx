import type { ReactNode } from 'react'
import type { ExtractionItem } from '@/entities/extraction'
import type { MinutesSummary, TranscriptLine } from '@/entities/minutes'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import type { ExtractedTasks, PendingTask } from '../lib/extractedTasks'
import { formatDue } from '../lib/format'

/* Meetings 캔버스 실측 — 영역 제목 14px 600 · 제목과 내용 14, 반영 카드 16 라운드 · 위아래 15 · 좌우 18 · 시각 칸 44,
   확인 필요 행 위아래 18 · 구분선, 제목 15px 600, 배지 21px */
const SECTION = 'flex flex-col gap-14'
const SECTION_TITLE = 'text-[14px] leading-[1.55] font-semibold text-ink'
const BODY = 'text-[14px] leading-[1.7] text-ink'
const EMPTY_TITLE = 'text-body font-semibold text-ink'
const EMPTY_TEXT = 'text-caption text-dim'
/* 녹음 회의의 `mm:ss` 는 44 칸에 들고, 채팅 회의의 `MM/DD HH:mm` 은 글자만큼 넓어진다 — 줄마다 글자 수가 같아 열이 맞는다 */
const TIME = 'min-w-44 shrink-0 text-[12px] leading-[1.7] whitespace-nowrap text-dim tabular-nums'
const APPLIED_ROW = 'flex items-start gap-14 rounded-16 border border-line bg-surface px-18 py-15'
const PENDING_ROW = 'flex items-start gap-16 border-b border-line py-18 last:border-b-0'
const BADGE_REVIEW =
  'inline-flex h-[21px] shrink-0 items-center gap-5 rounded-6 bg-ink px-8 text-meta leading-none font-semibold text-surface'
const BADGE_HOLD =
  'inline-flex h-[21px] shrink-0 items-center rounded-6 bg-control px-8 text-meta leading-none font-semibold text-sub'
const REVIEW_LINK =
  'inline-flex h-32 shrink-0 items-center gap-3 px-4 text-caption font-semibold text-ink hover:text-sub'
/*
 * 긴 전사문 (U5-8). 줄마다 `content-visibility: auto` 라 화면 밖 줄은 그리기를 미룬다. 크기 짐작(본문 한두 줄 높이)이 없으면
 * 미룬 줄이 0 높이가 돼 스크롤 막대가 튄다 — 짐작값은 레이아웃 계산용이지 보이는 크기가 아니다
 */
const TRANSCRIPT_LINE =
  'flex items-start gap-14 border-b border-divider py-12 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_64px]'

/**
 * Notion 반영 안내 (D-101, U5-8). 확실한 것은 바로, 확인이 필요한 것은 승인 뒤다.
 * 일반 팀원에게는 확인 필요의 존재를 드러내지 않는 앞 문장만 보인다 (D-104)
 */
export const NOTION_NOTE_FOR_PM =
  '회의록과 확실한 태스크는 정리가 끝나면 바로 Notion에 반영하고, 확인이 필요한 일은 승인한 뒤 반영해요.'
export const NOTION_NOTE_FOR_MEMBER =
  '회의록과 확실한 태스크는 정리가 끝나면 바로 Notion에 반영해요.'

/** 빈 상태 한 칸. 영역마다 따로 비어 있을 수 있어 화면 전체 빈 상태(EmptyState)가 아니라 영역 안의 글이다 */
function SectionEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-16 bg-surface-sunken px-18 py-15">
      <p className={EMPTY_TITLE}>{title}</p>
      <p className={EMPTY_TEXT}>{description}</p>
    </div>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-12">
        <h3 className={SECTION_TITLE}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 요약 탭. 실 API 는 아직 요약을 채우지 않아 늘 null 이다 (계약 §4.7-4) — 빈 상태가 기본이다 */
export function SummaryPanel({ summary }: { summary: MinutesSummary | null }) {
  const overview = summary?.overview.trim() ?? ''
  if (
    summary === null ||
    (overview === '' && summary.keyPoints.length === 0 && summary.decisions.length === 0)
  )
    return (
      <SectionEmpty
        title="요약이 아직 없어요"
        description="이 회의는 요약 없이 정리됐어요. 발언은 전사문에서 볼 수 있어요."
      />
    )
  return (
    <>
      {overview === '' ? null : <p className={BODY}>{overview}</p>}
      {summary.keyPoints.length === 0 ? null : (
        <Section title="핵심 내용">
          <ul className="flex list-disc flex-col gap-6 pl-20">
            {summary.keyPoints.map((point, index) => (
              <li key={index} className={BODY}>
                {point}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {summary.decisions.length === 0 ? null : (
        <Section title="결정한 것">
          <ul className="flex list-disc flex-col gap-6 pl-20">
            {summary.decisions.map((decision, index) => (
              <li key={index} className={BODY}>
                {decision}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

/** 회의 안 시각(ms)을 보이는 글자로. 녹음 회의와 채팅 회의가 읽는 방식이 달라 회의록이 정해 준다 (`formatMoment`) */
export type MomentOf = (atMs: number) => string

/** 전사문 탭. 화자 이름이 등록되지 않았으면 Discord 이름으로 보인다 (D-028) */
export function TranscriptPanel({
  transcript,
  momentOf,
}: {
  transcript: readonly TranscriptLine[]
  momentOf: MomentOf
}) {
  if (transcript.length === 0)
    return (
      <SectionEmpty title="전사문이 없어요" description="이 회의에서 옮겨 적은 발언이 없어요." />
    )
  return (
    <ol aria-label="전사문" className="flex flex-col">
      {transcript.map((line, index) => (
        <li key={index} className={TRANSCRIPT_LINE}>
          <span className={TIME}>{momentOf(line.atMs)}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span
              className={
                line.isFallbackName
                  ? 'text-caption font-semibold text-dim'
                  : 'text-caption font-semibold text-ink'
              }
            >
              {line.speakerName}
            </span>
            <p className={BODY}>{line.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export type TasksState =
  | { kind: 'missing' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'ready'; tasks: ExtractedTasks }

export type ReviewState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'ready' }

function itemMeta(item: ExtractionItem): string {
  const due = formatDue(item.dueDate)
  return [
    item.assigneeLabel === '' ? null : `담당 ${item.assigneeLabel}`,
    due === null ? null : `마감 ${due}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

function evidenceTime(item: ExtractionItem, momentOf: MomentOf): string {
  return item.evidence.atMs === null ? '' : momentOf(item.evidence.atMs)
}

function AppliedList({
  workspaceId,
  items,
  momentOf,
}: {
  workspaceId: string
  items: ExtractionItem[]
  momentOf: MomentOf
}) {
  if (items.length === 0)
    return (
      <SectionEmpty
        title="아직 반영된 태스크가 없어요"
        description="확실한 할 일이 나오면 정리하면서 바로 태스크로 만들어요."
      />
    )
  return (
    <ul className="flex flex-col gap-10">
      {items.map((item) => {
        const meta = itemMeta(item)
        return (
          <li key={item.id} className={APPLIED_ROW}>
            <span className={TIME}>{evidenceTime(item, momentOf)}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {item.appliedTaskId === null ? null : (
                <GuardedLink
                  to={paths.tasks(workspaceId, item.appliedTaskId)}
                  className="self-start text-[14px] leading-[1.7] font-semibold text-ink hover:text-sub"
                >
                  {item.title}
                </GuardedLink>
              )}
              {meta === '' ? null : <span className="text-caption text-dim">{meta}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function PendingRow({
  workspaceId,
  task,
  momentOf,
}: {
  workspaceId: string
  task: PendingTask
  momentOf: MomentOf
}) {
  const hold = task.item.gate === 'hold'
  const action = hold ? '채워 넣기' : '확인하기'
  return (
    <li className={PENDING_ROW}>
      <div className="flex min-w-0 flex-1 flex-col gap-9">
        <div className="flex flex-wrap items-center gap-10">
          {hold ? (
            <span className={BADGE_HOLD}>보류</span>
          ) : (
            <span className={BADGE_REVIEW}>
              <span aria-hidden="true" className="size-5 shrink-0 rounded-999 bg-surface" />
              확인 필요
            </span>
          )}
          <span className="text-[15px] leading-[1.55] font-semibold text-ink">
            {task.item.title}
          </span>
          <span className="text-meta text-dim tabular-nums">
            {evidenceTime(task.item, momentOf)}
          </span>
        </div>
        <p className="text-caption text-sub">{task.reason}</p>
      </div>
      <GuardedLink
        to={paths.approval(workspaceId, task.approvalId)}
        aria-label={`${task.item.title} ${action}`}
        className={REVIEW_LINK}
      >
        {action}
        <Icon name="chevron-right" size={13} />
      </GuardedLink>
    </li>
  )
}

function ReviewSection({
  workspaceId,
  pending,
  review,
  momentOf,
}: {
  workspaceId: string
  pending: PendingTask[] | null
  review: Exclude<ReviewState, { kind: 'hidden' }>
  momentOf: MomentOf
}) {
  const indicator = useLoadingIndicator(review.kind === 'loading')
  const count =
    review.kind === 'ready' && pending !== null && !indicator.pending ? pending.length : null
  return (
    <Section
      title={
        <>
          확인이 필요한 일
          {count === null ? null : (
            <>
              {' '}
              <span className="font-normal text-dim tabular-nums">{count}</span>
            </>
          )}
        </>
      }
    >
      {review.kind === 'loading' || indicator.pending ? (
        <DeferredSkeleton indicator={indicator}>
          <Skeleton lines={3} />
        </DeferredSkeleton>
      ) : review.kind === 'error' ? (
        <Reveal indicator={indicator}>
          <QueryErrorState
            error={review.error}
            onRetry={review.retry}
            title="확인이 필요한 일을 불러오지 못했어요"
          />
        </Reveal>
      ) : pending === null || pending.length === 0 ? (
        <Reveal indicator={indicator}>
          <SectionEmpty
            title="확인이 필요한 일이 없어요"
            description="이 회의에서 나온 할 일은 모두 반영됐거나 처리됐어요."
          />
        </Reveal>
      ) : (
        <Reveal indicator={indicator}>
          <ul className="flex flex-col">
            {pending.map((task) => (
              <PendingRow
                key={task.item.id}
                workspaceId={workspaceId}
                task={task}
                momentOf={momentOf}
              />
            ))}
          </ul>
        </Reveal>
      )}
    </Section>
  )
}

/**
 * 추출된 일 탭 (U5-5~U5-7). 반영된 것은 모두에게, 확인이 필요한 일은 볼 수 있는 PM 에게만 그린다.
 * 일반 팀원에게는 그 영역·개수·이동 링크를 DOM 에 두지 않는다 (D-104) — `review.kind === 'hidden'`.
 * 되돌리기 같은 변경 액션은 M6 이라 없다 (D-105).
 */
export function TasksPanel({
  workspaceId,
  state,
  review,
  momentOf,
}: {
  workspaceId: string
  state: TasksState
  review: ReviewState
  momentOf: MomentOf
}) {
  const note = review.kind === 'hidden' ? NOTION_NOTE_FOR_MEMBER : NOTION_NOTE_FOR_PM
  const indicator = useLoadingIndicator(state.kind === 'loading')
  let body: ReactNode
  if (state.kind === 'missing')
    body = (
      <SectionEmpty title="추출된 일이 없어요" description="이 회의에서는 할 일을 찾지 못했어요." />
    )
  else if (state.kind === 'loading') body = null
  else if (state.kind === 'error')
    body = (
      <QueryErrorState
        error={state.error}
        onRetry={state.retry}
        title="추출된 일을 불러오지 못했어요"
      />
    )
  else
    body = (
      <>
        <Section title="반영된 것">
          <AppliedList workspaceId={workspaceId} items={state.tasks.applied} momentOf={momentOf} />
        </Section>
        {review.kind === 'hidden' ? null : (
          <ReviewSection
            workspaceId={workspaceId}
            pending={state.tasks.pending}
            review={review}
            momentOf={momentOf}
          />
        )}
      </>
    )
  body = indicator.pending ? (
    <DeferredSkeleton indicator={indicator}>
      <Skeleton lines={4} />
    </DeferredSkeleton>
  ) : (
    <Reveal indicator={indicator}>{body}</Reveal>
  )
  return (
    <>
      {body}
      <p className="text-caption text-dim">{note}</p>
    </>
  )
}
