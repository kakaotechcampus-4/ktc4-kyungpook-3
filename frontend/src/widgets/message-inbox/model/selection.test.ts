import type { Bundle, MessageInbox, MessageThreadSummary } from '@/entities/message'
import { inboxPane, selectDetail } from './selection'

const bundle = (id: string, stage: Bundle['stage'] = 'awaitingApproval') =>
  ({ id, stage }) as Bundle
const summary = (id: string) => ({ id }) as MessageThreadSummary
const pmInbox = (bundles: Bundle[], threads: string[]): MessageInbox => ({
  viewer: 'pm',
  bundles,
  threads: threads.map(summary),
})
const memberInbox = (threads: string[]): MessageInbox => ({
  viewer: 'member',
  threads: threads.map(summary),
})

const select = (input: Partial<Parameters<typeof selectDetail>[0]>) =>
  selectDetail({
    inbox: undefined,
    threadId: null,
    bundleId: undefined,
    invalidPath: false,
    composing: false,
    ...input,
  })

it('주소가 틀리면 목록보다 먼저 없는 대화다', () => {
  expect(select({ invalidPath: true }).kind).toBe('invalid')
  expect(
    select({ inbox: pmInbox([bundle('bd_01')], ['th_01']), threadId: 'th_01', invalidPath: true })
      .kind,
  ).toBe('invalid')
})

it('대화 주소가 있으면 목록을 기다리지 않고 그 대화를 연다', () => {
  expect(select({ threadId: 'th_06', bundleId: 'bd_05' })).toEqual({
    kind: 'thread',
    threadId: 'th_06',
  })
})

it('목록이 없으면 고르지 않고 기다린다', () => {
  expect(select({}).kind).toBe('loading')
  expect(select({ bundleId: 'bd_01' }).kind).toBe('loading')
})

it('팀원은 묶음 파라미터를 무시하고 첫 대화를 연다. 대화가 없으면 고를 것이 없다', () => {
  expect(select({ inbox: memberInbox(['th_06', 'th_01']), bundleId: 'bd_05' })).toEqual({
    kind: 'thread',
    threadId: 'th_06',
  })
  expect(select({ inbox: memberInbox([]) }).kind).toBe('choose')
})

it('PM 은 파라미터가 없으면 아직 승인하지 않은 첫 묶음을, 모두 승인했으면 첫 묶음을 연다', () => {
  const approvedFirst = pmInbox([bundle('bd_01', 'approved'), bundle('bd_02')], ['th_01'])
  expect(select({ inbox: approvedFirst })).toMatchObject({
    kind: 'bundle',
    bundle: { id: 'bd_02' },
  })
  const allApproved = pmInbox([bundle('bd_01', 'approved'), bundle('bd_02', 'approved')], [])
  expect(select({ inbox: allApproved })).toMatchObject({ kind: 'bundle', bundle: { id: 'bd_01' } })
})

it('PM 이 고른 묶음을 열고, 목록에 없거나 모양이 틀린 파라미터는 고를 것이 없다', () => {
  const loaded = pmInbox([bundle('bd_01'), bundle('bd_02')], ['th_01'])
  expect(select({ inbox: loaded, bundleId: 'bd_02' })).toMatchObject({
    kind: 'bundle',
    bundle: { id: 'bd_02' },
  })
  expect(select({ inbox: loaded, bundleId: null }).kind).toBe('choose')
  expect(select({ inbox: loaded, bundleId: 'bd_99' }).kind).toBe('choose')
  expect(select({ inbox: pmInbox([], ['th_01']) }).kind).toBe('choose')
})

it('재촉 만들기는 목록을 기다리지 않고 고른 묶음보다 앞선다. 대화 주소와 틀린 주소가 먼저다', () => {
  expect(select({ composing: true })).toEqual({ kind: 'compose' })
  expect(
    select({ inbox: pmInbox([bundle('bd_01')], []), bundleId: 'bd_01', composing: true }),
  ).toEqual({ kind: 'compose' })
  expect(select({ threadId: 'th_01', composing: true }).kind).toBe('thread')
  expect(select({ invalidPath: true, composing: true }).kind).toBe('invalid')
})

describe('inboxPane', () => {
  const pane = (input: Partial<Parameters<typeof inboxPane>[0]>) =>
    inboxPane({
      compact: true,
      threadId: null,
      bundleId: undefined,
      invalidPath: false,
      composing: false,
      ...input,
    })

  it('넓은 화면은 무엇을 골랐든 목록과 상세를 나란히 둔다', () => {
    expect(pane({ compact: false })).toBe('both')
    expect(pane({ compact: false, threadId: 'th_01' })).toBe('both')
  })

  it('휴대폰은 주소가 아무것도 가리키지 않으면 목록이다 — 첫 항목을 대신 고르지 않는다', () => {
    expect(pane({})).toBe('list')
  })

  it('휴대폰은 주소가 대화·묶음·새 재촉·틀린 주소를 가리키면 상세를 화면 전체로 연다', () => {
    expect(pane({ threadId: 'th_01' })).toBe('detail')
    expect(pane({ bundleId: 'bd_01' })).toBe('detail')
    expect(pane({ bundleId: null })).toBe('detail')
    expect(pane({ composing: true })).toBe('detail')
    expect(pane({ invalidPath: true })).toBe('detail')
  })
})
