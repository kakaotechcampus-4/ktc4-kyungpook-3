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
import {
  approveBundle,
  cancelBundle,
  editBundle,
  rebuildBundle,
  threadSummaryOf,
} from './message-state'
import type { BundleContext } from './message-state'

/* 메시지 상태 전이 — 백엔드 services/messages.py 와 같은 규칙인지 본다 */

const bundle = (): MockBundle => structuredClone(messageBundleFixtures[0])
const context = (bundles: MockBundle[] = [], overrides: Partial<BundleContext> = {}) => ({
  bundles,
  threads: messageThreadFixtures,
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
    expect(cancelBundle(target)).toBeNull()
    expect(target.status).toBe('cancelled')
    expect(target.reminders.map(({ status }) => status)).toEqual(['cancelled'])
    expect(cancelBundle(target)).toBe('not_editable')
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
      body: `이재환님, 김서연이에요.\n'API 명세서' 마감이 9/24(목)이라 한번 여쭤봐요.\n${ASK}\n\n'ERD 정리' 마감이 9/24(목)이라 한번 여쭤봐요.\n${ASK}`,
    })
    expect(into.reminders.map(({ reminder_id, bundle_id }) => [reminder_id, bundle_id])).toEqual([
      ['rm_01', 'bd_01'],
      ['rm_07', 'bd_01'],
    ])
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
