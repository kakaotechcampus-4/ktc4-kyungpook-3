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
  TopicNode,
} from '@/entities/project-map'
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
import { GuardedLink, guardLeave } from '@/shared/lib/unsaved-changes'
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
  /** `fromEdit` 는 이름이 겹쳐 고치기 폼에서 연 합치기다. 취소하면 폼으로 돌아간다 */
  | { kind: 'merge'; intoTopicId: string | null; fromEdit: boolean }
  | { kind: 'detach'; taskId: string }
  | { kind: 'edit-decision'; decisionId: string }
  | { kind: 'remove-decision'; decisionId: string }

const VIEW: PanelMode = { kind: 'view' }

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
  topic,
  detail,
  map,
  onSelect,
}: {
  workspaceId: string
  topic: TopicNode
  detail: TopicDetail
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const editor = useTopicEdit(workspaceId, topic.id)
  const [mode, setShownMode] = useState<PanelMode>(VIEW)
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
  const refocus = useRef<(() => HTMLElement | null | undefined) | null>(null)
  useEffect(() => {
    const target = refocus.current?.()
    refocus.current = null
    target?.focus()
  }, [mode])

  // 저장하는 동안에는 다른 고치기를 열지 않는다. 쓰던 폼을 두고 옮기면 앱의 이탈 확인으로 묻는다
  const open = (next: PanelMode) => {
    if (editor.pending) return
    guardLeave(() => {
      editor.clearFailure()
      setMode(next)
    })
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
    .filter(({ topic: other }) => other.id !== topic.id)
    .map(({ topic: other }) => ({ value: other.id, label: other.label }))
  const editingTopic = mode.kind === 'edit-topic' || (mode.kind === 'merge' && mode.fromEdit)

  const topicFailure = failureFor((edit) => edit.kind === 'topic')
  const takenId = topicFailure?.takenTopicId ?? null
  const taken = takenId === null ? undefined : map.nodeById.get(takenId)
  const topicAlert =
    topicFailure === null ? null : (
      <div className="flex flex-col items-start gap-8">
        <Alert>
          {taken === undefined ? topicFailure.message : `「${taken.label}」 주제가 이미 있어요.`}
        </Alert>
        {taken?.kind === 'topic' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMode({ kind: 'merge', intoTopicId: taken.id, fromEdit: true })}
          >
            이 주제와 합치기
          </Button>
        ) : null}
      </div>
    )

  const detaching =
    mode.kind === 'detach' ? detail.tasks.find(({ taskId }) => taskId === mode.taskId) : undefined
  const removing = mode.kind === 'remove-decision' ? mode.decisionId : null

  return (
    <div className={BODY}>
      {editingTopic ? (
        <TopicFieldsForm
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
                onClick={() => open({ kind: 'merge', intoTopicId: null, fromEdit: false })}
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
          targets={targets}
          initialTarget={mode.intoTopicId}
          pending={editor.pending}
          failure={failureFor((edit) => edit.kind === 'merge')?.message ?? null}
          onConfirm={(intoTopicId) =>
            editor.run({ kind: 'merge', intoTopicId }, (into) => {
              toast.show({ title: '주제를 합쳤어요.' })
              onSelect({ kind: 'topic', id: into.topicId })
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
    </div>
  )
}

/** 주제 패널 본문. 주제가 바뀌면 새로 그린다(key) — 열린 폼·확인 창은 그 주제의 것이다 */
export function TopicBody({
  workspaceId,
  topic,
  map,
  onSelect,
}: {
  workspaceId: string
  topic: TopicNode
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const query = useQuery(topicQueryOptions(workspaceId, topic.id))
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
      topic={topic}
      detail={query.data!}
      map={map}
      onSelect={onSelect}
    />
  )
}
