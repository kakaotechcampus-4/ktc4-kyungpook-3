import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { topicQueryOptions } from '@/entities/project-map'
import type {
  MapSelection,
  ProjectMap,
  TopicDecision,
  TopicDetail,
  TopicEdit,
} from '@/entities/project-map'
import type { EditFormHandle } from '@/features/topic-edit'
import {
  DecisionMenu,
  DecisionTextForm,
  EditConfirm,
  TopicFieldsForm,
  TopicMergeModal,
  useTopicEdit,
} from '@/features/topic-edit'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { queryView } from '@/shared/lib/query-view'
import { GuardedLink, useUnsavedChangesStore } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'
import { BADGE, NOTE } from './frame'
import { BODY, LIST, MeetingLinks, Section, TaskLine } from './panelParts'

const DESCRIPTION = 'text-body text-sub'
const ACTIONS = 'flex flex-wrap items-center gap-8'
const ALERT = 'text-caption text-danger'

/**
 * 패널이 지금 여는 고치기. 한 번에 하나다. 유효하지 않음 표시와 되돌리기는 바로 보내 여기에 없다.
 * 여는 값마다 새 객체라, 저장을 시작한 고치기가 아직 열려 있는지를 같은 객체인지로 본다
 */
type PanelMode =
  | { kind: 'view' }
  | { kind: 'edit-topic' }
  /**
   * `into` 는 미리 고른 대상이다. 이름이 겹친 주제는 맵에 아직 없을 수 있어 이름을 같이 둔다.
   * `fromEdit` 는 이름이 겹쳐 고치기 폼에서 연 합치기다. 취소하면 폼으로 돌아간다
   */
  | { kind: 'merge'; into: { id: string; label: string } | null; fromEdit: boolean }
  | { kind: 'detach'; taskId: string }
  | { kind: 'edit-decision'; decisionId: string }
  | { kind: 'remove-decision'; decisionId: string }

const VIEW: PanelMode = { kind: 'view' }

/**
 * 409 `TOPIC_NAME_TAKEN` 이 알려 준 주제. 맵을 받은 뒤 다른 팀원이 만든 주제일 수 있어 맵에 없어도 상세로 이름을 받는다.
 * 상세가 404 면 그 사이 사라진 주제라 권하지 않는다(null). 이름을 아직 모르면 `label` 이 null 이다
 */
function useTakenTopic(
  workspaceId: string,
  takenId: string | null,
  map: ProjectMap,
): { id: string; label: string | null } | null {
  const query = useQuery({
    ...topicQueryOptions(workspaceId, takenId ?? ''),
    enabled: takenId !== null,
  })
  if (takenId === null) return null
  if (query.error instanceof ApiError && query.error.code === ERROR_CODES.TOPIC_NOT_FOUND)
    return null
  const node = map.nodeById.get(takenId)
  return { id: takenId, label: query.data?.name ?? (node?.kind === 'topic' ? node.label : null) }
}

function Decision({
  workspaceId,
  decision,
  menu,
  form,
  alert,
}: {
  workspaceId: string
  decision: TopicDecision
  menu: ReactNode
  /** 문장을 고치는 중이면 문장 자리에 폼이 온다 */
  form: ReactNode
  alert: ReactNode
}) {
  const reversed = decision.replacedBy !== null
  const invalid = decision.state === 'invalid'
  return (
    <li className="flex items-start gap-8">
      <div className="flex min-w-[0px] flex-1 flex-col gap-4">
        {form ?? (
          <p className={reversed || invalid ? 'text-body text-dim' : 'text-body text-ink'}>
            {decision.text}
            {reversed ? (
              <>
                {' '}
                <span className={BADGE}>뒤집힘</span>
              </>
            ) : null}
            {invalid ? (
              <>
                {' '}
                <span className={BADGE}>유효하지 않음</span>
              </>
            ) : null}
            {decision.edited ? (
              <>
                {' '}
                <span className={BADGE}>고침</span>
              </>
            ) : null}
          </p>
        )}
        {reversed ? <p className={NOTE}>다른 결정으로 바뀌었어요.</p> : null}
        {invalid ? <p className={NOTE}>팀원이 유효하지 않다고 표시했어요.</p> : null}
        {decision.reason === null ? null : <p className={NOTE}>이유: {decision.reason}</p>}
        <p className={NOTE}>
          <GuardedLink
            to={paths.meetings(workspaceId, decision.meetingId)}
            className="underline-offset-4 hover:underline"
          >
            {decision.meetingTitle ?? '제목 없는 회의'}
          </GuardedLink>{' '}
          · {seoulDateOf(decision.decidedAt)}
        </p>
        {alert}
      </div>
      {menu}
    </li>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={ALERT}>
      {children}
    </p>
  )
}

/**
 * 받은 주제를 보이고 고친다 (#551 묶음 B). 고친 응답이 오면 이 주제 캐시가 바뀌어 다시 그려진다.
 * 폼·확인 창을 닫으면 연 단추로, 줄이 사라지면 그 묶음 제목으로 포커스를 옮긴다
 */
function TopicView({
  workspaceId,
  topicId,
  detail,
  map,
  onSelect,
}: {
  workspaceId: string
  topicId: string
  detail: TopicDetail
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const editor = useTopicEdit(workspaceId, topicId)
  const [mode, setShownMode] = useState<PanelMode>(VIEW)
  // 쓰던 폼을 두고 열려던 고치기. 있으면 버릴지 묻는다
  const [pendingSwitch, setPendingSwitch] = useState<PanelMode | null>(null)
  // 열린 고치기 폼. 한 번에 하나라 하나로 둔다
  const form = useRef<EditFormHandle>(null)
  // 저장 응답이 올 때의 모드. 렌더를 기다리지 않고 읽는다
  const shown = useRef<PanelMode>(VIEW)
  const setMode = (next: PanelMode) => {
    shown.current = next
    setShownMode(next)
  }
  const editButton = useRef<HTMLButtonElement>(null)
  const decisionsHeading = useRef<HTMLHeadingElement>(null)
  const tasksHeading = useRef<HTMLHeadingElement>(null)
  const decisionMenus = useRef(new Map<string, HTMLButtonElement>())
  // 닫은 뒤 포커스를 둘 곳. 닫힌 화면이 그려진 뒤에 찾는다 — 폼 자리에 단추가 다시 생긴다
  const refocus = useRef<(() => { focus: () => void } | null | undefined) | null>(null)
  // 앱의 이탈 확인(뒤로가기 등)이 열려 있다. 그 창이 포커스를 가두는 동안에는 패널 안으로 옮기지 않는다
  const leaving = useUnsavedChangesStore((state) => state.pendingLeave !== null)
  useEffect(() => {
    if (leaving) return
    const target = refocus.current?.()
    refocus.current = null
    target?.focus()
  }, [mode, pendingSwitch, leaving])
  // 이탈 확인이 뜨면 같은 제목의 패널 안 확인은 닫는다. 쓰던 폼은 두고, 계속 쓰기로 하면 그 칸으로 돌아간다 —
  // 이탈 확인을 연 단추가 패널 안 확인과 함께 사라져 그대로면 포커스가 body 로 떨어진다
  useEffect(() => {
    if (pendingSwitch === null) return
    return useUnsavedChangesStore.subscribe(({ pendingLeave }) => {
      if (pendingLeave === null) return
      refocus.current = () => form.current
      setPendingSwitch(null)
    })
  }, [pendingSwitch])

  const switchTo = (next: PanelMode) => {
    editor.clearFailure()
    setMode(next)
  }
  // 저장하는 동안에는 다른 고치기를 열지 않는다. 쓰던 폼을 두고 옮기면 패널 안 확인으로 묻는다 —
  // 경로를 떠나지 않으므로 앱의 이탈 확인 문구는 맞지 않는다
  const open = (next: PanelMode) => {
    if (editor.pending) return
    if (form.current?.dirty === true) setPendingSwitch(next)
    else switchTo(next)
  }
  const close = (focus: () => HTMLElement | null | undefined) => {
    refocus.current = focus
    setMode(VIEW)
  }
  /** 저장이 끝난 뒤 닫는다. 그 저장을 시작한 고치기가 아직 열려 있을 때만이다 */
  const closeAfterSave =
    (started: PanelMode, focus: () => HTMLElement | null | undefined) => () => {
      if (shown.current === started) close(focus)
    }
  const failureFor = (match: (edit: TopicEdit) => boolean) =>
    editor.failure !== null && match(editor.failure.edit) ? editor.failure : null
  const decisionFailure = (
    decisionId: string,
    match: (edit: TopicEdit & { kind: 'decision' }) => boolean,
  ) =>
    failureFor((edit) => edit.kind === 'decision' && edit.decisionId === decisionId && match(edit))
      ?.message

  const targets = map.topicGroups
    .filter(({ topic }) => topic.id !== topicId)
    .map(({ topic }) => ({ value: topic.id, label: topic.label }))
  const editingTopic = mode.kind === 'edit-topic' || (mode.kind === 'merge' && mode.fromEdit)

  const topicFailure = failureFor((edit) => edit.kind === 'topic')
  const taken = useTakenTopic(workspaceId, topicFailure?.takenTopicId ?? null, map)
  // 이름을 아직 모르면 보낸 이름으로 고르게 한다 — 정규화하면 그 주제의 이름과 같다
  const sentName = topicFailure?.edit.kind === 'topic' ? topicFailure.edit.name : undefined
  const topicAlert =
    topicFailure === null ? null : (
      <div className="flex flex-col items-start gap-8">
        <Alert>
          {taken === null || taken.label === null
            ? topicFailure.message
            : `「${taken.label}」 주제가 이미 있어요.`}
        </Alert>
        {taken === null ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setMode({
                kind: 'merge',
                into: { id: taken.id, label: taken.label ?? sentName ?? taken.id },
                fromEdit: true,
              })
            }
          >
            이 주제와 합치기
          </Button>
        )}
      </div>
    )

  const detaching =
    mode.kind === 'detach' ? detail.tasks.find(({ taskId }) => taskId === mode.taskId) : undefined
  const removing = mode.kind === 'remove-decision' ? mode.decisionId : null

  return (
    <div className={BODY}>
      {editingTopic ? (
        <TopicFieldsForm
          ref={form}
          name={detail.name}
          description={detail.description}
          pending={editor.pending}
          alert={topicAlert}
          onSave={(change) =>
            editor.run(
              { kind: 'topic', ...change },
              closeAfterSave(mode, () => editButton.current),
            )
          }
          onCancel={() => close(() => editButton.current)}
        />
      ) : (
        <div className="flex flex-col gap-10">
          {detail.description === '' ? null : <p className={DESCRIPTION}>{detail.description}</p>}
          {detail.edited ? <p className={NOTE}>팀원이 고친 주제예요.</p> : null}
          <div className={ACTIONS}>
            <Button
              ref={editButton}
              variant="outline"
              size="sm"
              disabled={editor.pending}
              onClick={() => open({ kind: 'edit-topic' })}
            >
              이름·설명 고치기
            </Button>
            {targets.length === 0 ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={editor.pending}
                onClick={() => open({ kind: 'merge', into: null, fromEdit: false })}
              >
                다른 주제와 합치기
              </Button>
            )}
          </div>
        </div>
      )}
      <Section title="결정" headingRef={decisionsHeading}>
        {detail.decisions.length === 0 ? (
          <p className={NOTE}>아직 결정이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-14">
            {detail.decisions.map((decision) => {
              const { decisionId } = decision
              const editingText = mode.kind === 'edit-decision' && mode.decisionId === decisionId
              const backToMenu = () => decisionMenus.current.get(decisionId)
              const textFailure = decisionFailure(decisionId, ({ text }) => text !== undefined)
              const stateFailure = decisionFailure(
                decisionId,
                ({ text, state }) => text === undefined && state !== 'removed',
              )
              return (
                <Decision
                  key={decisionId}
                  workspaceId={workspaceId}
                  decision={decision}
                  form={
                    editingText ? (
                      <DecisionTextForm
                        ref={form}
                        text={decision.text}
                        pending={editor.pending}
                        alert={textFailure === undefined ? null : <Alert>{textFailure}</Alert>}
                        onSave={(text) =>
                          editor.run(
                            { kind: 'decision', decisionId, text },
                            closeAfterSave(mode, backToMenu),
                          )
                        }
                        onCancel={() => close(backToMenu)}
                      />
                    ) : null
                  }
                  alert={stateFailure === undefined ? null : <Alert>{stateFailure}</Alert>}
                  menu={
                    <DecisionMenu
                      decision={decision}
                      pending={editor.pending}
                      triggerRef={(node) => {
                        if (node === null) decisionMenus.current.delete(decisionId)
                        else decisionMenus.current.set(decisionId, node)
                      }}
                      onEditText={() => open({ kind: 'edit-decision', decisionId })}
                      onToggleValid={() =>
                        editor.run({
                          kind: 'decision',
                          decisionId,
                          state: decision.state === 'invalid' ? 'valid' : 'invalid',
                        })
                      }
                      onRemove={() => open({ kind: 'remove-decision', decisionId })}
                    />
                  }
                />
              )
            })}
          </ul>
        )}
      </Section>
      <Section title="태스크" headingRef={tasksHeading}>
        {detail.tasks.length === 0 ? (
          <p className={NOTE}>이어진 태스크가 없어요.</p>
        ) : (
          <ul className={LIST}>
            {detail.tasks.map((task) => (
              <li key={task.taskId} className="flex items-center gap-8">
                <div className="min-w-[0px] flex-1">
                  {/* 맵을 받은 뒤 생긴 태스크는 패널을 열 데이터가 없어 글로만 둔다 */}
                  <TaskLine
                    status={task.status}
                    title={task.title}
                    onOpen={
                      map.nodeById.has(task.taskId)
                        ? () => onSelect({ kind: 'task', id: task.taskId })
                        : undefined
                    }
                  />
                </div>
                <Button
                  variant="text"
                  size="sm"
                  aria-label={`${task.title} 떼기`}
                  disabled={editor.pending}
                  onClick={() => open({ kind: 'detach', taskId: task.taskId })}
                >
                  떼기
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="나온 회의">
        <MeetingLinks workspaceId={workspaceId} meetings={detail.meetings} />
      </Section>

      {mode.kind === 'merge' ? (
        <TopicMergeModal
          targets={
            mode.into === null || targets.some(({ value }) => value === mode.into?.id)
              ? targets
              : [...targets, { value: mode.into.id, label: mode.into.label }]
          }
          initialTarget={mode.into?.id ?? null}
          pending={editor.pending}
          failure={failureFor((edit) => edit.kind === 'merge')?.message ?? null}
          onConfirm={(intoTopicId) =>
            editor.run({ kind: 'merge', intoTopicId }, (into) => {
              toast.show({ title: '주제를 합쳤어요.' })
              onSelect({ kind: 'topic', id: into.topicId, label: into.name })
            })
          }
          onCancel={() => setMode(mode.fromEdit ? { kind: 'edit-topic' } : VIEW)}
        />
      ) : null}
      {mode.kind === 'detach' ? (
        <EditConfirm
          title="이 주제에서 태스크를 뗄까요?"
          description={`「${detaching?.title ?? '이 태스크'}」 태스크와 이 주제의 연결을 지워요. 다시 요약해도 다시 붙지 않고, 이 화면에서는 다시 붙일 수 없어요.`}
          confirmLabel="떼기"
          pending={editor.pending}
          failure={failureFor((edit) => edit.kind === 'detach')?.message ?? null}
          onConfirm={() =>
            editor.run({ kind: 'detach', taskId: mode.taskId }, () => {
              toast.show({ title: '태스크를 뗐어요.' })
              closeAfterSave(mode, () => tasksHeading.current)()
            })
          }
          onCancel={() => setMode(VIEW)}
        />
      ) : null}
      {removing === null ? null : (
        <EditConfirm
          title="결정을 지울까요?"
          description={
            <>
              회의록·요약본·주제에서 이 결정이 빠져요. 지운 결정은 이 화면에서 되살릴 수 없어요.
              {detail.decisions.some(({ replacedBy }) => replacedBy === removing)
                ? ' 이 결정이 뒤집었던 결정은, 그 결정을 뒤집은 다른 결정이 없으면 다시 유효해져요.'
                : null}
            </>
          }
          confirmLabel="지우기"
          pending={editor.pending}
          failure={decisionFailure(removing, ({ state }) => state === 'removed') ?? null}
          onConfirm={() =>
            editor.run(
              { kind: 'decision', decisionId: removing, state: 'removed' },
              closeAfterSave(mode, () => decisionsHeading.current),
            )
          }
          onCancel={() => setMode(VIEW)}
        />
      )}
      {pendingSwitch === null ? null : (
        <EditConfirm
          title="저장하지 않은 변경 내용이 있어요"
          description="쓰던 내용은 버려지고 다른 고치기가 열려요."
          confirmLabel="버리기"
          cancelLabel="계속 작성하기"
          pending={false}
          failure={null}
          onConfirm={() => {
            setPendingSwitch(null)
            switchTo(pendingSwitch)
          }}
          onCancel={() => {
            // 확인 창은 닫히며 연 단추로 돌아가려 한다. 그보다 먼저 쓰던 칸에 둔다
            refocus.current = () => form.current
            setPendingSwitch(null)
          }}
        />
      )}
    </div>
  )
}

/** 주제 패널 본문. 주제가 바뀌면 새로 그린다(key) — 열린 폼·확인 창은 그 주제의 것이다 */
export function TopicBody({
  workspaceId,
  topicId,
  map,
  onSelect,
}: {
  workspaceId: string
  topicId: string
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const query = useQuery(topicQueryOptions(workspaceId, topicId))
  const view = queryView(query)
  if (view === 'loading')
    return (
      <div role="status" aria-label="주제를 불러오는 중" className="flex flex-col gap-10">
        <Skeleton variant="text" lines={3} />
      </div>
    )
  if (view === 'error') {
    if (query.error instanceof ApiError && query.error.code === ERROR_CODES.TOPIC_NOT_FOUND)
      return <p className={NOTE}>{errorMessage(query.error)}</p>
    return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  return (
    <TopicView
      workspaceId={workspaceId}
      topicId={topicId}
      detail={query.data!}
      map={map}
      onSelect={onSelect}
    />
  )
}
