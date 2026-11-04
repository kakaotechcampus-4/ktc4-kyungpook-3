import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ExtractionItem } from '@/entities/extraction'
import type { Task } from '@/entities/task'
import { RevertConfirmModal, useAutoItemRevert } from '@/features/auto-item-revert'
import type { AutoItemRevertOutcome } from '@/features/auto-item-revert'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import {
  RECENT_MORE_LINE_PX,
  RECENT_ROWS,
  fitRecentRows,
  recentEmptyReason,
  recentSyncState,
  revertOutcome,
} from '../lib/dashboard'
import type { RecentEmptyReason, RecentSyncState } from '../lib/dashboard'
import type { DashboardData, Loadable } from '../model/useDashboardData'
import { BADGE, EMPTY_NOTE, HEAD_LINK, SECTION_HEAD, SECTION_TITLE, SectionBody } from './parts'

const ROW = 'flex flex-col gap-6 border-b border-line px-18 py-12 last:border-b-0'
const ROW_MAIN = 'flex items-center gap-10'
const ROW_TEXT = 'min-w-[0px] flex-1 text-caption text-sub'
/** 행 동작(되돌리기 버튼, 확인 필요 이동 링크)의 아이콘 자리. 둘이 같은 자리·크기에 번갈아 온다 */
const ROW_ICON_ACTION =
  'inline-flex h-26 w-26 shrink-0 items-center justify-center rounded-7 text-sub hover:bg-control hover:text-ink disabled:text-line-strong'
const MESSAGE = 'flex flex-wrap items-center gap-8 text-meta text-dim'
const MESSAGE_LINK = 'font-semibold text-ink underline-offset-2 hover:underline'
const EMPTY = 'flex flex-col items-start gap-10 py-18'
const EMPTY_TITLE = 'text-body font-semibold text-ink'
const EMPTY_LINK =
  'inline-flex h-32 items-center justify-center rounded-9 bg-control px-12 text-control font-semibold text-ink hover:bg-line-strong'
/** `외 N건` 줄. 높이가 RECENT_MORE_LINE_PX 다 */
const MORE_LINE = 'flex h-32 items-center px-18'

/** 행 상태 문구. `synced` 만 반영 완료다. 되돌림이 가장 먼저다 (계획 §3) */
const SYNC_LABEL: Record<RecentSyncState, string> = {
  reverted: '되돌림',
  pending: '반영 대기',
  failed: '반영 실패',
  synced: '반영 완료',
  none: '반영 상태 없음',
  unknown: '상태 알 수 없음',
}

const SYNC_TONE: Record<RecentSyncState, string> = {
  reverted: 'bg-ink text-surface',
  pending: 'bg-control text-sub',
  failed: 'bg-surface text-accent border border-accent',
  synced: 'bg-control text-ink',
  none: 'bg-control text-dim',
  unknown: 'bg-control text-dim',
}

export interface RecentSectionProps {
  workspaceId: string
  isPm: boolean
  data: DashboardData
}

/**
 * 최근 반영 (Main 시안 오른쪽 아래, D-035~D-042). 최신 완료 회의 한 건의 `gate=auto` 항목만 응답 순서로 보인다.
 * 첫 화면에 들어가는 만큼 3~8개를 보이고, 남은 항목은 `외 N건 · 회의록에서 보기` 로 그 회의록에 넘긴다 (D-176).
 * 상태는 연결된 태스크의 `notion_sync_status` 로 구분하고, PM 은 행에서 바로 되돌린다(확인 모달 → 서버 성공 뒤 `되돌림`).
 * `전체 로그` 는 1차 범위 밖이라 비활성이다
 */
export function RecentSection({ workspaceId, isPm, data }: RecentSectionProps) {
  return (
    <section aria-labelledby="dashboard-recent">
      <div className={SECTION_HEAD}>
        <h2 id="dashboard-recent" className={SECTION_TITLE}>
          최근 반영
        </h2>
        <Button variant="text" size="sm" disabled className="px-0">
          전체 로그
        </Button>
      </div>
      <RecentBody workspaceId={workspaceId} isPm={isPm} data={data} />
    </section>
  )
}

function RecentBody({ workspaceId, isPm, data }: RecentSectionProps) {
  const { recent, integrations, autoItems } = data
  // 판정 순서(회의 없음 → Notion → 항목 없음)를 지키려고 앞 조회부터 차례로 본다
  if (recent === undefined)
    return (
      <SectionBody state={data.meetings} errorTitle="회의 정보를 불러오지 못했어요">
        {() => null}
      </SectionBody>
    )
  if (recent === null)
    return <RecentEmpty workspaceId={workspaceId} isPm={isPm} reason="no-meeting" latestId={null} />
  return (
    <SectionBody state={integrations} errorTitle="연동 상태를 불러오지 못했어요">
      {(connected) => {
        if (connected.notion.status !== 'connected')
          return (
            <RecentEmpty
              workspaceId={workspaceId}
              isPm={isPm}
              reason="notion"
              latestId={recent.meeting.id}
            />
          )
        return (
          <SectionBody state={recent.extraction} errorTitle="최근 반영을 불러오지 못했어요">
            {(extraction) => {
              const reason = recentEmptyReason({
                latestMeeting: recent.meeting,
                notionStatus: connected.notion.status,
                autoItems: extraction === null ? [] : autoItems,
              })
              if (reason !== null || extraction === null)
                return (
                  <RecentEmpty
                    workspaceId={workspaceId}
                    isPm={isPm}
                    reason={reason ?? 'no-auto'}
                    latestId={recent.meeting.id}
                  />
                )
              return (
                <RecentList
                  workspaceId={workspaceId}
                  isPm={isPm}
                  meetingId={recent.meeting.id}
                  extractionId={extraction.id}
                  items={autoItems}
                  tasks={data.tasks}
                />
              )
            }}
          </SectionBody>
        )
      }}
    </SectionBody>
  )
}

interface RecentEmptyProps {
  workspaceId: string
  isPm: boolean
  reason: RecentEmptyReason
  /** 최근 회의록으로 갈 회의. 회의가 없으면 null */
  latestId: string | null
}

/** 빈 상태 세 갈래 (D-040~D-042). 회의 업로드·Notion 설정은 PM 만 할 수 있어 일반 팀원에게는 이동을 두지 않는다 */
function RecentEmpty({ workspaceId, isPm, reason, latestId }: RecentEmptyProps) {
  if (reason === 'no-meeting')
    return (
      <div className={EMPTY}>
        <p className={EMPTY_TITLE}>아직 정리한 회의가 없어요</p>
        <p className="text-caption text-dim">회의를 정리하면 자동으로 반영한 일이 여기에 보여요.</p>
        {isPm ? (
          <GuardedLink to={paths.meetingUpload(workspaceId)} className={EMPTY_LINK}>
            회의 업로드
          </GuardedLink>
        ) : null}
      </div>
    )
  if (reason === 'notion')
    return (
      <div className={EMPTY}>
        <p className={EMPTY_TITLE}>Notion이 연결되지 않았어요</p>
        <p className="text-caption text-dim">Notion을 연결하면 확실한 일은 자동으로 반영해요.</p>
        {isPm ? (
          <GuardedLink to={paths.settingsNotion(workspaceId)} className={EMPTY_LINK}>
            Notion 설정
          </GuardedLink>
        ) : null}
      </div>
    )
  return (
    <div className={EMPTY}>
      <p className={EMPTY_TITLE}>최근 회의에서 자동으로 반영한 일이 없어요</p>
      <p className="text-caption text-dim">확인이 필요한 일은 회의록과 태스크에서 볼 수 있어요.</p>
      {latestId === null ? null : (
        <GuardedLink to={paths.meetings(workspaceId, latestId)} className={EMPTY_LINK}>
          최근 회의록
        </GuardedLink>
      )}
    </div>
  )
}

interface RecentListProps {
  workspaceId: string
  isPm: boolean
  /** 항목이 나온 회의. 넘친 항목은 이 회의록에서 본다 */
  meetingId: string
  extractionId: string
  /** auto 항목 전부. 앞에서 들어가는 만큼만 그린다 */
  items: readonly ExtractionItem[]
  tasks: Loadable<Task[]>
}

/**
 * 첫 화면에 들어가는 행 수 (D-176). 처음엔 최대 8행까지 그려 재고, 칠하기 전(layout effect)에 줄인다.
 * 위치는 문서 기준이라 스크롤로는 다시 재지 않는다. 다시 재는 때: 창 크기, 목록 크기,
 * 그리고 목록 위에 놓인 것들(목록에서 main 까지 각 조상의 앞 형제 — 머리·요약·마감 임박)의 크기.
 * main 은 화면 높이를 채우고(flex-1), 왼쪽 칸이 더 길면 오른쪽 칸이 자라도 높이가 그대로라 main 만 봐서는 위치 변화를 놓친다.
 * 행 높이는 항목마다 기억한다 — 줄여서 지운 행도 다시 늘릴 때 그 높이로 친다
 */
function useFittedRowCount(
  listRef: RefObject<HTMLUListElement | null>,
  items: readonly ExtractionItem[],
): number {
  const [shown, setShown] = useState(() => Math.min(items.length, RECENT_ROWS.max))
  const heights = useRef(new Map<string, number>())
  const itemsRef = useRef(items)

  const measure = useCallback(() => {
    const list = listRef.current
    if (list === null) return
    const all = itemsRef.current
    Array.from(list.children).forEach((row, index) => {
      const item = all[index]
      const height = row.getBoundingClientRect().height
      // 레이아웃이 없으면(jsdom·숨은 화면) 0 이다. 잰 것으로 치지 않는다
      if (item !== undefined && height > 0) heights.current.set(item.id, height)
    })
    const top = list.getBoundingClientRect().top + window.scrollY
    setShown(
      fitRecentRows({
        available: window.innerHeight - top,
        heights: all.slice(0, RECENT_ROWS.max).map(({ id }) => heights.current.get(id)),
        total: all.length,
        moreLine: RECENT_MORE_LINE_PX,
      }),
    )
  }, [listRef])

  useLayoutEffect(() => {
    itemsRef.current = items
    measure()
  }, [measure, items, shown])

  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    let frame: number | null = null
    // 관찰 콜백에서 바로 그리면 ResizeObserver loop 경고가 난다. 한 프레임에 한 번만 잰다
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        measure()
      })
    }
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(list)
    const main = list.closest('main')
    for (let node: Element | null = list; node !== null && node !== main; node = node.parentElement)
      for (let before = node.previousElementSibling; before; before = before.previousElementSibling)
        observer.observe(before)
    if (main !== null) observer.observe(main)
    return () => {
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [listRef, measure])

  return Math.min(shown, items.length)
}

function RecentList({ workspaceId, isPm, meetingId, extractionId, items, tasks }: RecentListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const shown = useFittedRowCount(listRef, items)
  const hidden = items.length - shown
  const control = useAutoItemRevert(workspaceId)
  const [confirming, setConfirming] = useState<ExtractionItem | null>(null)
  const tasksById = useMemo(
    () => (tasks.status === 'ready' ? new Map(tasks.data.map((task) => [task.id, task])) : null),
    [tasks],
  )

  // 모달은 서버 응답(성공·거절·실패)이 온 뒤에 닫는다. 그동안은 닫히지 않고 두 번 보내지 않는다
  const confirm = () => {
    if (confirming !== null) control.revert(extractionId, confirming.id, () => setConfirming(null))
  }

  return (
    <>
      <ul ref={listRef} aria-label="최근 반영 목록">
        {items.slice(0, shown).map((item) => (
          <RecentRow
            key={item.id}
            workspaceId={workspaceId}
            item={item}
            state={recentSyncState(item, tasksById)}
            tasksLoading={tasks.status === 'loading'}
            isPm={isPm}
            pending={control.pendingItemId === item.id}
            busy={control.pendingItemId !== null}
            outcome={control.outcomes.get(item.id)}
            confirmOpen={confirming !== null}
            onRevert={() => setConfirming(item)}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <div className={MORE_LINE}>
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={HEAD_LINK}>
            외 {hidden}건 · 회의록에서 보기
            <Icon name="chevron-right" size={13} />
          </GuardedLink>
        </div>
      ) : null}
      {tasks.status === 'error' ? (
        <p className={EMPTY_NOTE}>태스크 목록을 불러오지 못해 반영 상태를 알 수 없어요.</p>
      ) : null}
      <RevertConfirmModal
        title={confirming?.title ?? null}
        pending={control.pendingItemId !== null}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

interface RecentRowProps {
  workspaceId: string
  item: ExtractionItem
  state: RecentSyncState
  /** 태스크 목록을 아직 받는 중이다. 상태를 모르는 행을 `확인 중` 으로 보인다 */
  tasksLoading: boolean
  /** PM 이다. 되돌리기 버튼과 되돌린 행의 확인 필요 상세 링크(PM 가드 경로)는 PM 에게만 그린다 (D-104, D-163) */
  isPm: boolean
  /** 이 행의 되돌리기가 진행 중이다 */
  pending: boolean
  /** 어느 행이든 되돌리기가 진행 중이다 */
  busy: boolean
  outcome: AutoItemRevertOutcome | undefined
  /** 되돌리기 확인 모달이 열려 있다. 닫힌 뒤에야 포커스를 옮긴다 (E-04) */
  confirmOpen: boolean
  onRevert: () => void
}

function RecentRow({
  workspaceId,
  item,
  state,
  tasksLoading,
  isPm,
  pending,
  busy,
  outcome,
  confirmOpen,
  onRevert,
}: RecentRowProps) {
  const messageId = useId()
  const titleId = useId()
  const badgeId = useId()
  const rowRef = useRef<HTMLLIElement>(null)
  // 포커스를 옮긴 되돌리기 결과. 같은 결과로는 다시 옮기지 않는다 — 재렌더·재조회·polling 이 포커스를 뺏지 않는다
  const focusedFor = useRef<AutoItemRevertOutcome | null>(null)

  /*
   * 되돌리기에 성공하면 연 버튼이 링크로 바뀌어 사라진다. 공통 Modal 은 연 요소가 없으면 포커스를 돌리지 않아 body 로 떨어진다 (E-04).
   * 모달이 닫힌 뒤 Radix 의 포커스 복귀(onCloseAutoFocus, 다음 태스크)가 끝난 다음에 본다. 그때도 포커스가 body 에 있을 때만
   * 이 행의 새 `확인 필요 보기` 링크로, 링크가 없으면 행으로 옮긴다. 사용자가 이미 다른 곳으로 옮겼으면 그대로 둔다(Modal 과 같은 규칙).
   * 취소·거부·실패는 버튼이 남아 Modal 이 그 버튼으로 돌린다
   */
  useEffect(() => {
    if (outcome?.kind !== 'reverted' || confirmOpen || focusedFor.current === outcome) return
    focusedFor.current = outcome
    const timer = setTimeout(() => {
      const active = document.activeElement
      if (active !== null && active !== document.body) return
      // 공통 링크(GuardedLink)가 ref 를 받지 않아 행 안에서 링크를 찾는다. 이 행의 링크는 `확인 필요 보기` 하나뿐이다
      const row = rowRef.current
      ;(row?.querySelector<HTMLElement>('a[href]') ?? row)?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [outcome, confirmOpen])
  // 되돌린 뒤의 지금 결과. 대기면 확인 필요 링크, 승인·반려면 처리가 끝나 링크·되돌리기가 없다 (E-03)
  const result = revertOutcome(item)
  const message =
    outcome === undefined || outcome.kind === 'reverted' || result !== null ? null : outcome
  return (
    // 행은 링크가 없을 때 포커스를 받는 자리다(tabIndex -1). 이름은 제목과 상태 배지다
    <li
      ref={rowRef}
      tabIndex={-1}
      aria-labelledby={`${titleId} ${badgeId}`}
      className={`${ROW} focus-visible:-outline-offset-2`}
      data-testid="recent-row"
    >
      <div className={ROW_MAIN}>
        <span id={titleId} className={ROW_TEXT}>
          자동 반영 — <span className="text-ink">{item.title}</span>
        </span>
        <span id={badgeId} className={`${BADGE} ${SYNC_TONE[state]}`}>
          {state === 'unknown' && tasksLoading ? '확인 중' : SYNC_LABEL[state]}
        </span>
        {/* 승인 상태는 PM 에게만 드러낸다 (D-104, E-01). 팀원은 상태 배지만 본다 */}
        {isPm && result === 'rejected' ? (
          <span className={`${BADGE} bg-control text-dim`}>반려됨</span>
        ) : null}
        {/* PM 전용 행 동작. 일반 팀원에게는 상태 배지만 남는다 */}
        {!isPm || result === 'approved' || result === 'rejected' ? null : result === 'waiting' ? (
          item.approvalId === null ? null : (
            <GuardedLink
              to={paths.approval(workspaceId, item.approvalId)}
              className={ROW_ICON_ACTION}
              aria-label={`확인 필요 보기 — ${item.title}`}
              title="확인 필요 보기"
            >
              <Icon name="arrow-right" size={14} />
            </GuardedLink>
          )
        ) : item.appliedTaskId !== null ? (
          <button
            type="button"
            className={ROW_ICON_ACTION}
            aria-label={`${item.title} 되돌리기`}
            aria-describedby={message === null ? undefined : messageId}
            aria-busy={pending || undefined}
            disabled={busy}
            onClick={onRevert}
          >
            <Icon name="undo" size={14} />
          </button>
        ) : null}
      </div>
      {isPm && result === 'approved' ? (
        <p className={MESSAGE}>되돌린 뒤 승인돼 다시 만들었어요</p>
      ) : null}
      {message === null ? null : (
        <p id={messageId} role="alert" className={MESSAGE}>
          {message.message}
          {message.kind === 'rejected' &&
          message.reason === 'task_changed' &&
          message.taskId !== null ? (
            <GuardedLink to={paths.tasks(workspaceId, message.taskId)} className={MESSAGE_LINK}>
              태스크 보기
            </GuardedLink>
          ) : null}
          {message.kind === 'rejected' &&
          message.reason === 'pending_approval' &&
          message.approvalId !== null ? (
            <GuardedLink
              to={paths.approval(workspaceId, message.approvalId)}
              className={MESSAGE_LINK}
            >
              확인 요청 보기
            </GuardedLink>
          ) : null}
        </p>
      )}
    </li>
  )
}
