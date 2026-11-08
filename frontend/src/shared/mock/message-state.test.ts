import { MOCK_NOW } from './fixtures/constants'
import {
  botMessage,
  mergeSourceBundle,
  messageBundleFixtures,
  messageThreadFixtures,
  reply,
  schedulePassedBundle,
} from './fixtures/message'
import type { MockBundle, MockMessageThread } from './fixtures/message'
import { memberFixtures } from './fixtures/member'
import {
  approveBundle,
  bundleDto,
  cancelBundle,
  cancelReminder,
  createReminder,
  editBundle,
  editReminder,
  rebuildBundle,
  reminderWithBundleDto,
  threadSummaryOf,
} from './message-state'
import type { BundleContext, ReminderContext, ReminderResult } from './message-state'

/* 메시지 상태 전이 — 백엔드 services/messages.py 와 같은 규칙인지 본다 */

const bundle = (): MockBundle => structuredClone(messageBundleFixtures[0])
const context = (
  bundles: MockBundle[] = [],
  overrides: Partial<BundleContext> = {},
): BundleContext => ({
  bundles,
  tasks: [],
  threads: messageThreadFixtures,
  taskHistory: [],
  members: memberFixtures,
  pmName: '김서연',
  workspaceName: '카테캠 3팀',
  ...overrides,
})
const ASK = '지금 어디까지 됐는지 편하게 알려 주세요!'

describe('threadSummaryOf', () => {
  const thread = (messages: MockMessageThread['messages']): MockMessageThread => ({
    ...structuredClone(messageThreadFixtures[0]),
    messages,
  })

  it('답장 대기는 팀원의 마지막 답 뒤에 처음 나간 봇 메시지의 시각이고, 시각은 UTC 로 낸다', () => {
    const summary = threadSummaryOf(
      thread([
        botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00'),
        reply('mg_2', 'b', '2026-09-15T10:00:00+09:00'),
        botMessage('mg_3', 'c', '2026-09-16T18:00:00+09:00'),
        botMessage('mg_4', 'd', '2026-09-17T18:00:00+09:00'),
      ]),
    )
    expect(summary.awaiting_reply_since).toBe('2026-09-16T09:00:00.000Z')
    expect(summary.last_message).toMatchObject({ message_id: 'mg_4', sender: 'bot' })
    expect(threadSummaryOf(thread([reply('mg_2', 'b', MOCK_NOW)])).awaiting_reply_since).toBeNull()
    expect(threadSummaryOf(thread([])).last_message).toBeNull()
  })

  it('dm_failed 는 마지막 봇 메시지만 본다', () => {
    const failed = { status: 'failed', reason: 'dm_blocked' } as const
    expect(
      threadSummaryOf(thread([botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00', failed)]))
        .dm_failed,
    ).toBe(true)
    expect(
      threadSummaryOf(
        thread([
          botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00', failed),
          botMessage('mg_2', 'b', '2026-09-16T09:00:00+09:00'),
          reply('mg_3', 'c', '2026-09-17T09:00:00+09:00'),
        ]),
      ).dm_failed,
    ).toBe(false)
  })
})

describe('approveBundle', () => {
  it('보는 판이 맞으면 승인하고 초안 대기를 닫는다', () => {
    const target = { ...bundle(), draft_status: 'needed' as const }
    expect(approveBundle(target, target.draft_version, MOCK_NOW)).toBeNull()
    expect(target).toMatchObject({ approved: true, approved_at: MOCK_NOW, draft_status: 'done' })
  })

  it('판이 다르면 changed, 시각이 지났으면 time_passed 이고 묶음은 그대로다', () => {
    const target = bundle()
    const before = structuredClone(target)
    expect(approveBundle(target, target.draft_version - 1, MOCK_NOW)).toBe('changed')
    const passed = structuredClone(schedulePassedBundle)
    expect(approveBundle(passed, passed.draft_version, MOCK_NOW)).toBe('time_passed')
    expect(target).toEqual(before)
    expect(passed).toEqual(schedulePassedBundle)
  })

  it('이미 승인했으면 판과 상관없이 그대로 성공이다. 예정이 아니면 not_editable 이다', () => {
    const target = { ...bundle(), approved: true, approved_at: '2026-09-17T09:00:00+09:00' }
    expect(approveBundle(target, 999, MOCK_NOW)).toBeNull()
    expect(target.approved_at).toBe('2026-09-17T09:00:00+09:00')
    expect(approveBundle({ ...bundle(), status: 'cancelled' }, 2, MOCK_NOW)).toBe('not_editable')
  })
})

describe('editBundle · cancelBundle', () => {
  it('문구를 고치면 PM 문구가 되고 판이 오르며 승인은 그대로다', () => {
    const target = { ...bundle(), approved: true, approved_at: MOCK_NOW }
    expect(editBundle(target, { body: '고친 문구' }, MOCK_NOW, context([target]))).toEqual({
      bundle: target,
    })
    expect(target).toMatchObject({
      body: '고친 문구',
      body_source: 'pm',
      draft_version: 3,
      approved: true,
    })
  })

  it('합쳐지지 않게 옮기면 판과 승인은 그대로이고, 지난 시각으로는 옮기지 못한다', () => {
    const target = { ...bundle(), approved: true, approved_at: MOCK_NOW }
    const space = context([target, structuredClone(messageBundleFixtures[1])])
    expect(
      editBundle(target, { scheduled_at: '2026-09-25T14:30:00+09:00' }, MOCK_NOW, space),
    ).toEqual({ bundle: target })
    expect(target).toMatchObject({
      scheduled_at: '2026-09-25T14:30:00+09:00',
      draft_version: 2,
      approved: true,
      approved_at: MOCK_NOW,
    })
    expect(
      editBundle(target, { scheduled_at: '2026-09-17T09:00:00+09:00' }, MOCK_NOW, space),
    ).toEqual({ refusal: 'time_passed' })
    // 같은 시각을 문구와 같이 보내는 것은 시각을 고친 것이 아니다
    const passed = structuredClone(schedulePassedBundle)
    expect(
      editBundle(
        passed,
        { body: '새 문구', scheduled_at: passed.scheduled_at },
        MOCK_NOW,
        context(),
      ),
    ).toEqual({ bundle: passed })
  })

  it('보내지 않으면 묶음과 안의 리마인드가 모두 취소되고, 두 번째는 not_editable 이다', () => {
    const target = bundle()
    expect(cancelBundle(target, MOCK_NOW)).toBeNull()
    expect(target.status).toBe('cancelled')
    expect(target.reminders.map(({ status }) => status)).toEqual(['cancelled'])
    expect(cancelBundle(target, MOCK_NOW)).toBe('not_editable')
    expect(editBundle(target, { body: 'x' }, MOCK_NOW, context())).toEqual({
      refusal: 'not_editable',
    })
  })
})

describe('editBundle — 같은 대화의 예정 묶음이 있는 시각으로 옮기면 합친다', () => {
  const pair = () => {
    const into = { ...bundle(), approved: true, approved_at: '2026-09-17T10:00:00+09:00' }
    const source = structuredClone(mergeSourceBundle)
    return { into, source, space: context([into, source]) }
  }

  it('리마인드를 옮기고 옮긴 묶음은 닫으며, 합친 묶음은 판이 오르고 승인이 풀린 규칙 문구가 된다', () => {
    const { into, source, space } = pair()
    expect(editBundle(source, { scheduled_at: '2026-09-23T00:00:00Z' }, MOCK_NOW, space)).toEqual({
      bundle: into,
    })
    expect(source).toMatchObject({ status: 'cancelled', approved: false, draft_version: 2 })
    expect(source.reminders).toEqual([])
    expect(into).toMatchObject({
      status: 'scheduled',
      scheduled_at: '2026-09-23T09:00:00+09:00',
      approved: false,
      approved_at: null,
      draft_version: 3,
      body_source: 'rule',
      draft_status: 'needed',
      body: `이재환님, 김서연이에요.\n'배포 스크립트' 마감이 9/24(목)이라 한번 여쭤봐요.\n${ASK}\n\n'ERD 정리' 마감이 9/24(목)이라 한번 여쭤봐요.\n${ASK}`,
    })
    expect(into.reminders.map(({ reminder_id, bundle_id }) => [reminder_id, bundle_id])).toEqual([
      ['rm_01', 'bd_01'],
      ['rm_07', 'bd_01'],
    ])
  })

  it('규칙 문구와 응답 리마인드는 태스크의 지금 제목·마감을 쓴다 — 리마인드를 만든 뒤 태스크를 고쳤어도', () => {
    const { into, source } = pair()
    const tasks = [
      {
        task_id: 'tk_95',
        title: 'ERD 최종본',
        due_date: '2026-09-25',
        created_at: '2026-09-14T00:00:00Z',
      },
    ]
    editBundle(source, { scheduled_at: into.scheduled_at }, MOCK_NOW, {
      ...context([into, source]),
      tasks,
    })
    expect(into.body).toBe(
      `이재환님, 김서연이에요.
'배포 스크립트' 마감이 9/24(목)이라 한번 여쭤봐요.
${ASK}

'ERD 최종본' 마감이 9/25(금)이라 한번 여쭤봐요.
${ASK}`,
    )
    expect(bundleDto(into, context()).reminders.at(-1)).toMatchObject({
      task_id: 'tk_95',
      task_title: 'ERD 최종본',
      due_date: '2026-09-25',
    })
  })

  it('합친 리마인드는 만든 순서(created_at, reminder_id)로 응답하고 문구도 그 순서다', () => {
    const { into, source, space } = pair()
    source.reminders[0].created_at = '2026-09-14T09:00:00+09:00'
    editBundle(source, { scheduled_at: into.scheduled_at }, MOCK_NOW, space)
    expect(bundleDto(into, space).reminders.map(({ reminder_id }) => reminder_id)).toEqual([
      'rm_07',
      'rm_01',
    ])
    expect(into.body.indexOf("'ERD 정리'")).toBeLessThan(into.body.indexOf("'배포 스크립트'"))
  })

  it('지금과 같은 시각은 옮긴 것이 아니라 아무것도 합치지 않는다', () => {
    const { into, source, space } = pair()
    const before = structuredClone({ into, source })
    expect(editBundle(source, { scheduled_at: source.scheduled_at }, MOCK_NOW, space)).toEqual({
      bundle: source,
    })
    expect({ into, source }).toEqual(before)
  })

  it('다른 대화의 묶음과는 같은 시각이어도 합치지 않는다', () => {
    const other = structuredClone(messageBundleFixtures[1])
    const into = bundle()
    expect(
      editBundle(other, { scheduled_at: into.scheduled_at }, MOCK_NOW, context([into, other])),
    ).toEqual({ bundle: other })
    expect(other.scheduled_at).toBe(into.scheduled_at)
    expect(into.reminders).toHaveLength(1)
  })

  it('합쳐지는 시각과 문구를 같이 보내면 거절하고 두 묶음 모두 그대로다', () => {
    const { into, source, space } = pair()
    const before = structuredClone({ into, source })
    expect(
      editBundle(source, { body: '고친 문구', scheduled_at: into.scheduled_at }, MOCK_NOW, space),
    ).toEqual({ refusal: 'merge_with_body' })
    expect({ into, source }).toEqual(before)
  })

  it('지난 시각은 합칠 상대가 있어도 먼저 time_passed 다', () => {
    const passed = structuredClone(schedulePassedBundle)
    const { source } = pair()
    expect(
      editBundle(
        source,
        { body: '고친 문구', scheduled_at: passed.scheduled_at },
        MOCK_NOW,
        context([source, passed]),
      ),
    ).toEqual({ refusal: 'time_passed' })
  })
})

describe('rebuildBundle', () => {
  it('메모 있는 리마인드 하나뿐이면 그 메모가 PM 문구다. 나간 DM 이 없는 대화는 PM 소개와 맺음을 씌운다', () => {
    const target = bundle()
    target.reminders[0].note = '명세서 초안만 먼저 공유해 주세요'
    rebuildBundle(target, context([], { threads: [], pmName: '이하나' }))
    expect(target).toMatchObject({
      body: '안녕하세요 이재환님, 카테캠 3팀 이하나예요.\n앞으로 확인용 메시지는 이 봇으로 보낼게요.\n\n명세서 초안만 먼저 공유해 주세요\n여기로 답장하시면 저한테 바로 전달돼요.',
      body_source: 'pm',
      draft_status: 'done',
      draft_version: 3,
    })
  })

  it('마감이 없는 태스크는 진행 상황을 묻고, 받침을 알 수 없는 이름은 (이)에요 다', () => {
    const target = structuredClone(messageBundleFixtures[1])
    target.reminders[0].note = null
    rebuildBundle(target, context([], { pmName: 'PM' }))
    expect(target.body).toBe(
      `정하늘님, PM(이)에요.\n'퍼블리싱' 진행 상황 한번 여쭤봐요.\n${ASK}\n\n'발표 자료' 마감이 9/30(수)이라 한번 여쭤봐요.\n${ASK}`,
    )
  })
})

describe('재촉 이유·근거·요약 — 백엔드 reminder_reason', () => {
  // 한국 시간 9/15(화) 09:00
  const TASK = {
    task_id: 'tk_04',
    title: '배포 스크립트',
    due_date: '2026-09-24',
    created_at: '2026-09-15T00:00:00Z',
  }
  const thread = (messages: MockMessageThread['messages']): MockMessageThread => ({
    ...structuredClone(messageThreadFixtures[0]),
    messages,
  })
  const change = (patch: Partial<BundleContext['taskHistory'][number]> = {}) => ({
    task_id: 'tk_04',
    changed_field: 'status',
    change_source: 'manual',
    created_at: '2026-09-16T03:00:00Z',
    ...patch,
  })
  const first = (overrides: Partial<BundleContext> = {}, target = bundle()) =>
    bundleDto(target, context([], { tasks: [TASK], threads: [thread([])], ...overrides }))
      .reminders[0]

  it('진행 소식이 없으면 태스크를 만든 날을 쓰고, 마감이 있으면 마감을 앞에 둔다', () => {
    expect(first()).toMatchObject({
      reason:
        "'배포 스크립트' 마감이 9/24(목)인데, 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.",
      evidence: null,
    })
    expect(first({ tasks: [{ ...TASK, due_date: null }] }).reason).toBe(
      '9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
    )
  })

  it('묶음 대화의 팀원 답장과 그 태스크의 변경 중 늦은 것이 근거이고, 같은 시각이면 답장이다. 날짜는 한국 시간이다', () => {
    // UTC 로는 9/16 이지만 한국 시간으로는 9/17 01:00 이다
    const answered = thread([reply('mg_9', '하는 중이에요', '2026-09-16T16:00:00Z')])
    expect(first({ threads: [answered], taskHistory: [change()] })).toMatchObject({
      reason: "'배포 스크립트' 마감이 9/24(목)인데, 9/17(목) 이후로 진행 소식이 없어요.",
      evidence: { kind: 'reply', at: '2026-09-16T16:00:00.000Z', message_id: 'mg_9' },
    })
    expect(
      first({
        threads: [answered],
        taskHistory: [change({ created_at: '2026-09-17T01:00:00Z' }), change()],
      }).evidence,
    ).toEqual({ kind: 'task_change', at: '2026-09-17T01:00:00.000Z', message_id: null })
    expect(
      first({ threads: [answered], taskHistory: [change({ created_at: '2026-09-16T16:00:00Z' })] })
        .evidence,
    ).toMatchObject({ kind: 'reply', message_id: 'mg_9' })
  })

  it('만들기 전 답장, 만든 지 5초 안의 변경, 스케줄러·답장으로 푼 변경, 응답이 아닌 칸, 봇 메시지는 소식이 아니다', () => {
    const notNews = first({
      threads: [
        thread([
          reply('mg_8', '전에 남긴 답장', '2026-09-14T09:00:00Z'),
          botMessage('mg_9', '봇 메시지', '2026-09-17T09:00:00Z'),
        ]),
      ],
      taskHistory: [
        change({ created_at: '2026-09-15T00:00:05Z' }),
        change({ change_source: 'scheduler' }),
        change({ change_source: 'reminder_reply' }),
        change({ changed_field: 'title' }),
        change({ task_id: 'tk_02' }),
      ],
    })
    expect(notNews).toMatchObject({
      reason:
        "'배포 스크립트' 마감이 9/24(목)인데, 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.",
      evidence: null,
    })
    expect(
      first({ taskHistory: [change({ created_at: '2026-09-15T00:00:06Z' })] }).evidence,
    ).toEqual({ kind: 'task_change', at: '2026-09-15T00:00:06.000Z', message_id: null })
  })

  it('PM 이 만든 재촉은 만든 PM 의 이름을 쓰고 마감을 붙이지 않는다. 그 팀원이 없으면 PM 이다', () => {
    const own = bundle()
    Object.assign(own.reminders[0], { origin: 'pm', created_by: 'mb_01' })
    expect(first({}, own).reason).toBe(
      '김서연님이 직접 만든 재촉이에요. 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
    )
    own.reminders[0].created_by = 'mb_99'
    expect(first({}, own).reason).toBe(
      'PM님이 직접 만든 재촉이에요. 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
    )
  })

  it('픽스처에 없는 태스크는 리마인드를 만든 때를 태스크를 만든 때로 본다', () => {
    const target = bundle()
    target.reminders[0].created_at = '2026-09-12T09:00:00+09:00'
    expect(first({ tasks: [] }, target).reason).toBe(
      "'배포 스크립트' 마감이 9/24(목)인데, 9/12(토)에 태스크를 만든 뒤로 진행 소식이 없어요.",
    )
  })

  it('요약은 첫 태스크와 나머지 건수다. 지운 태스크는 이유·근거가 null 이고 요약에서 지워진 태스크다', () => {
    expect(bundleDto(bundle(), context()).summary).toBe('배포 스크립트 진행 상황 확인')
    expect(bundleDto(structuredClone(messageBundleFixtures[1]), context()).summary).toBe(
      '퍼블리싱 외 1건 진행 상황 확인',
    )
    const deleted = bundle()
    Object.assign(deleted.reminders[0], { task_id: null, task_title: null, due_date: null })
    const dto = bundleDto(deleted, context([], { tasks: [TASK] }))
    expect(dto.summary).toBe('지워진 태스크 진행 상황 확인')
    expect(dto.reminders[0]).toMatchObject({ reason: null, evidence: null })
  })
})

/* 리마인드 하나의 만들기·고치기·빼기 — 백엔드 create_reminder·edit_reminder·cancel_reminder */

const CREATED = '2026-09-10T00:00:00Z'
const TASKS = [
  { task_id: 'tk_01', title: '로그인 API 연동', due_date: '2026-09-20', created_at: CREATED },
  { task_id: 'tk_02', title: '회원가입 화면', due_date: '2026-09-16', created_at: CREATED },
  { task_id: 'tk_03', title: 'DB 스키마 정리', due_date: '2026-09-22', created_at: CREATED },
  { task_id: 'tk_04', title: '배포 스크립트', due_date: '2026-09-24', created_at: CREATED },
]

/** ws_01 하나. allBundles·allThreads 는 db 칸처럼 새 묶음·대화가 들어간다 */
function workspace(): ReminderContext {
  const allBundles = structuredClone(messageBundleFixtures)
  const allThreads = structuredClone(messageThreadFixtures)
  return {
    workspaceId: 'ws_01',
    bundles: allBundles,
    threads: allThreads,
    tasks: TASKS,
    taskHistory: [],
    members: memberFixtures,
    pmName: '김서연',
    workspaceName: '카테캠 3팀',
    allBundles,
    allThreads,
  }
}
const bundleIn = (space: ReminderContext, bundleId: string) => {
  const found = space.allBundles.find(({ bundle_id }) => bundle_id === bundleId)
  if (!found) throw new Error(`bundle ${bundleId} is missing`)
  return found
}
const reminderIn = (bundle: MockBundle, reminderId: string) => {
  const found = bundle.reminders.find(({ reminder_id }) => reminder_id === reminderId)
  if (!found) throw new Error(`reminder ${reminderId} is missing`)
  return found
}
function accepted(result: ReminderResult) {
  if ('refusal' in result) throw new Error(`refused: ${result.refusal}`)
  return result
}

describe('createReminder', () => {
  const input = {
    task_id: 'tk_02',
    member_id: 'mb_02',
    scheduled_at: '2026-09-21T09:00:00+09:00',
    note: null,
    created_by: 'mb_01',
  }

  it('그 팀원·시각의 예정 묶음이 없으면 새 묶음을 만들고, 규칙 문구로 판 1 의 승인 전 묶음이 된다', () => {
    const space = workspace()
    const result = accepted(createReminder(input, MOCK_NOW, space))
    expect(space.allBundles).toHaveLength(3)
    expect(result.bundle).toMatchObject({
      bundle_id: 'bd_03',
      thread_id: 'th_02',
      member_id: 'mb_02',
      recipient_name: '박민수',
      status: 'scheduled',
      approved: false,
      draft_version: 1,
      body_source: 'rule',
      draft_status: 'needed',
    })
    expect(result.reminder).toMatchObject({
      reminder_id: 'rm_04',
      bundle_id: 'bd_03',
      task_title: '회원가입 화면',
      origin: 'pm',
      status: 'scheduled',
    })
    expect(
      reminderWithBundleDto(result, space).bundle.reminders.map(({ reminder_id }) => reminder_id),
    ).toEqual(['rm_04'])
  })

  it('그 팀원과의 대화가 없으면 메시지 없는 대화를 만든다. 담당자가 아니어도 받는다', () => {
    const space = workspace()
    const result = accepted(
      createReminder({ ...input, task_id: 'tk_03', member_id: 'mb_01' }, MOCK_NOW, space),
    )
    expect(space.allThreads.at(-1)).toEqual({
      thread_id: 'th_12',
      workspace_id: 'ws_01',
      member_id: 'mb_01',
      name: '김서연',
      messages: [],
    })
    expect(result.bundle.thread_id).toBe('th_12')
    expect(result.bundle.body.startsWith('안녕하세요 김서연님, 카테캠 3팀 김서연이에요.')).toBe(
      true,
    )
  })

  it('메모가 있는 하나뿐인 재촉은 메모가 PM 문구다', () => {
    const { bundle } = accepted(
      createReminder({ ...input, note: '화면 캡처만 먼저요' }, MOCK_NOW, workspace()),
    )
    expect(bundle).toMatchObject({ body_source: 'pm', draft_status: 'done' })
    expect(bundle.body).toContain('화면 캡처만 먼저요')
  })

  it('같은 시각의 예정 묶음이 있으면 거기에 넣고 승인을 푼다', () => {
    const space = workspace()
    const target = bundleIn(space, 'bd_01')
    target.approved = true
    target.approved_at = '2026-09-17T10:00:00+09:00'
    const { bundle } = accepted(
      createReminder(
        { ...input, task_id: 'tk_03', member_id: 'mb_03', scheduled_at: '2026-09-23T00:00:00Z' },
        MOCK_NOW,
        space,
      ),
    )
    expect(bundle).toBe(target)
    expect(space.allBundles).toHaveLength(2)
    expect(bundle).toMatchObject({
      approved: false,
      approved_at: null,
      draft_version: 3,
      body_source: 'rule',
    })
    expect(bundleDto(bundle, space).reminders.map(({ task_id }) => task_id)).toEqual([
      'tk_04',
      'tk_03',
    ])
  })

  it('같은 묶음에 같은 태스크가 이미 있으면 그 리마인드를 돌려주고 아무것도 바꾸지 않는다', () => {
    const space = workspace()
    const before = structuredClone(space.allBundles)
    const result = accepted(
      createReminder(
        {
          task_id: 'tk_04',
          member_id: 'mb_03',
          scheduled_at: '2026-09-23T09:00:00+09:00',
          note: '다른 메모',
          created_by: 'mb_01',
        },
        MOCK_NOW,
        space,
      ),
    )
    expect(result.reminder.reminder_id).toBe('rm_01')
    expect(space.allBundles).toEqual(before)
  })

  it('없는 태스크·없는 팀원·지난 시각은 거절하고 db 는 그대로다. 태스크를 먼저 본다', () => {
    const space = workspace()
    const before = structuredClone({ bundles: space.allBundles, threads: space.allThreads })
    expect(
      createReminder({ ...input, task_id: 'tk_99', member_id: 'mb_99' }, MOCK_NOW, space),
    ).toEqual({ refusal: 'task_not_found' })
    expect(createReminder({ ...input, member_id: 'mb_99' }, MOCK_NOW, space)).toEqual({
      refusal: 'member_not_found',
    })
    expect(createReminder({ ...input, scheduled_at: MOCK_NOW }, MOCK_NOW, space)).toEqual({
      refusal: 'time_passed',
    })
    expect({ bundles: space.allBundles, threads: space.allThreads }).toEqual(before)
  })
})

describe('editReminder', () => {
  const approvedBundle = (space: ReminderContext) => {
    const bundle = bundleIn(space, 'bd_02')
    bundle.approved = true
    bundle.approved_at = MOCK_NOW
    return bundle
  }

  it('같은 메모면 아무것도 바꾸지 않는다 — 판도 승인도 그대로다', () => {
    const space = workspace()
    const bundle = approvedBundle(space)
    const before = structuredClone(bundle)
    accepted(
      editReminder(
        bundle,
        reminderIn(bundle, 'rm_02'),
        { note: '시안 2차 반영분까지' },
        MOCK_NOW,
        space,
      ),
    )
    expect(bundle).toEqual(before)
  })

  it('메모를 바꾸면 문구를 다시 만들고 판을 올리고 승인을 푼다. null 이면 메모를 지운다', () => {
    const space = workspace()
    const bundle = approvedBundle(space)
    const rm02 = reminderIn(bundle, 'rm_02')
    accepted(editReminder(bundle, rm02, { note: '시안 3차까지' }, MOCK_NOW, space))
    expect(bundle).toMatchObject({
      approved: false,
      approved_at: null,
      draft_version: 2,
      body_source: 'rule',
    })
    expect(bundle.body).toContain('시안 3차까지')

    accepted(editReminder(bundle, rm02, { note: null }, MOCK_NOW, space))
    expect(rm02.note).toBeNull()
    expect(bundle.draft_version).toBe(3)
    expect(bundle.body).toContain("'퍼블리싱' 진행 상황 한번 여쭤봐요.")
  })

  it('다른 시각으로 옮기면 그 시각의 묶음으로 가고 두 묶음을 다시 만든다. 마지막 하나였으면 남은 묶음은 닫힌다', () => {
    const space = workspace()
    const source = bundleIn(space, 'bd_01')
    const { bundle } = accepted(
      editReminder(
        source,
        reminderIn(source, 'rm_01'),
        { scheduled_at: '2026-09-22T09:00:00+09:00' },
        MOCK_NOW,
        space,
      ),
    )
    expect(bundle.bundle_id).toBe('bd_03')
    expect(bundle.reminders.map(({ reminder_id, bundle_id }) => [reminder_id, bundle_id])).toEqual([
      ['rm_01', 'bd_03'],
    ])
    expect(source.status).toBe('cancelled')
  })

  it('예정이 아닌 리마인드는 고치지 못하고, 지난 시각으로는 옮기지 못한다', () => {
    const space = workspace()
    const bundle = bundleIn(space, 'bd_02')
    const rm02 = reminderIn(bundle, 'rm_02')
    const before = structuredClone(bundle)
    expect(editReminder(bundle, rm02, { scheduled_at: MOCK_NOW }, MOCK_NOW, space)).toEqual({
      refusal: 'time_passed',
    })
    expect(bundle).toEqual(before)
    rm02.status = 'cancelled'
    expect(editReminder(bundle, rm02, { note: 'x' }, MOCK_NOW, space)).toEqual({
      refusal: 'not_editable',
    })
  })
})

describe('cancelReminder', () => {
  it('하나를 빼면 남은 태스크로 문구를 다시 만들고 승인을 푼다. 응답에는 남은 리마인드만 있다', () => {
    const space = workspace()
    const bundle = bundleIn(space, 'bd_02')
    bundle.approved = true
    bundle.approved_at = MOCK_NOW
    const dto = reminderWithBundleDto(
      accepted(cancelReminder(bundle, reminderIn(bundle, 'rm_02'), MOCK_NOW, space)),
      space,
    )
    expect(dto.reminder).toMatchObject({ reminder_id: 'rm_02', status: 'cancelled' })
    expect(dto.bundle).toMatchObject({ status: 'scheduled', approved: false, draft_version: 2 })
    expect(dto.bundle.reminders.map(({ reminder_id }) => reminder_id)).toEqual(['rm_03'])
    expect(dto.bundle.body).not.toContain('퍼블리싱')
  })

  it('마지막 하나를 빼면 묶음이 취소되고, 응답 리마인드는 묶음이 닫힐 때 함께 취소된 것뿐이다', () => {
    const space = workspace()
    const bundle = bundleIn(space, 'bd_02')
    accepted(
      cancelReminder(bundle, reminderIn(bundle, 'rm_02'), '2026-09-18T09:00:00+09:00', space),
    )
    const dto = reminderWithBundleDto(
      accepted(
        cancelReminder(bundle, reminderIn(bundle, 'rm_03'), '2026-09-18T10:00:00+09:00', space),
      ),
      space,
    )
    expect(dto.bundle.status).toBe('cancelled')
    expect(dto.bundle.reminders.map(({ reminder_id }) => reminder_id)).toEqual(['rm_03'])
    expect(cancelReminder(bundle, reminderIn(bundle, 'rm_03'), MOCK_NOW, space)).toEqual({
      refusal: 'not_editable',
    })
  })

  it('보내지 않음으로 닫은 묶음은 그때 함께 취소된 리마인드를 싣는다 — 먼저 뺀 것은 빠진다', () => {
    const space = workspace()
    const bundle = bundleIn(space, 'bd_02')
    accepted(
      cancelReminder(bundle, reminderIn(bundle, 'rm_02'), '2026-09-18T09:00:00+09:00', space),
    )
    expect(cancelBundle(bundle, '2026-09-18T10:00:00+09:00')).toBeNull()
    expect(bundleDto(bundle, space).reminders.map(({ reminder_id }) => reminder_id)).toEqual([
      'rm_03',
    ])
  })
})
