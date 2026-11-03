import type { MessageInbox, MessageReview, MessageThreadSummary } from '@/entities/message'
import { selectDetail } from './selection'
import { VIEWER_POLICY } from './viewer'

const review = (id: string, status: 'pending' | 'scheduled' = 'pending') =>
  ({
    id,
    state:
      status === 'scheduled'
        ? { status: 'scheduled', approvedBy: '최진호' }
        : { status: 'pending' },
  }) as MessageReview
const summary = (id: string) => ({ id }) as MessageThreadSummary
const inbox = (reviews: string[], threads: string[]): MessageInbox => ({
  reviews: reviews.map((id) => review(id)),
  threads: threads.map(summary),
})

const pm = VIEWER_POLICY.pm
const member = VIEWER_POLICY.member

it('주소가 틀리면 목록보다 먼저 없는 대화다', () => {
  expect(
    selectDetail({
      inbox: undefined,
      threadId: null,
      reviewId: undefined,
      invalidPath: true,
      policy: pm,
    }).kind,
  ).toBe('invalid')
  expect(
    selectDetail({
      inbox: inbox(['rv_01'], ['th_01']),
      threadId: 'th_01',
      reviewId: 'rv_01',
      invalidPath: true,
      policy: member,
    }).kind,
  ).toBe('invalid')
})

it('대화 주소가 있으면 목록을 기다리지 않고 그 대화를 연다', () => {
  expect(
    selectDetail({
      inbox: undefined,
      threadId: 'th_06',
      reviewId: 'rv_05',
      invalidPath: false,
      policy: member,
    }),
  ).toEqual({ kind: 'thread', threadId: 'th_06' })
  expect(
    selectDetail({
      inbox: undefined,
      threadId: 'th_01',
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }),
  ).toEqual({ kind: 'thread', threadId: 'th_01' })
})

it('목록이 없으면 고르지 않고 기다린다', () => {
  expect(
    selectDetail({
      inbox: undefined,
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }).kind,
  ).toBe('loading')
  expect(
    selectDetail({
      inbox: undefined,
      threadId: null,
      reviewId: 'rv_01',
      invalidPath: false,
      policy: member,
    }).kind,
  ).toBe('loading')
})

it('팀원은 검토 파라미터를 무시하고 첫 대화를 연다', () => {
  expect(
    selectDetail({
      inbox: inbox(['rv_05'], ['th_06', 'th_01']),
      threadId: null,
      reviewId: 'rv_05',
      invalidPath: false,
      policy: member,
    }),
  ).toEqual({ kind: 'thread', threadId: 'th_06' })
  expect(
    selectDetail({
      inbox: inbox([], []),
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: member,
    }).kind,
  ).toBe('choose')
})

it('PM 은 파라미터가 없으면 아직 결정하지 않은 첫 검토를, 없으면 고르지 않은 칸을 연다', () => {
  const loaded = inbox(['rv_01', 'rv_02'], ['th_01'])
  expect(
    selectDetail({
      inbox: loaded,
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }),
  ).toEqual({ kind: 'review', review: loaded.reviews[0] })
  const scheduledFirst: MessageInbox = {
    reviews: [review('rv_01', 'scheduled'), review('rv_02')],
    threads: [summary('th_01')],
  }
  expect(
    selectDetail({
      inbox: scheduledFirst,
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }),
  ).toEqual({ kind: 'review', review: scheduledFirst.reviews[1] })
  const allScheduled: MessageInbox = {
    reviews: [review('rv_01', 'scheduled'), review('rv_02', 'scheduled')],
    threads: [],
  }
  expect(
    selectDetail({
      inbox: allScheduled,
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }),
  ).toEqual({ kind: 'review', review: allScheduled.reviews[0] })
  expect(
    selectDetail({
      inbox: loaded,
      threadId: null,
      reviewId: 'rv_02',
      invalidPath: false,
      policy: pm,
    }),
  ).toEqual({ kind: 'review', review: loaded.reviews[1] })
  expect(
    selectDetail({
      inbox: loaded,
      threadId: null,
      reviewId: null,
      invalidPath: false,
      policy: pm,
    }).kind,
  ).toBe('choose')
  expect(
    selectDetail({
      inbox: loaded,
      threadId: null,
      reviewId: 'rv_99',
      invalidPath: false,
      policy: pm,
    }).kind,
  ).toBe('choose')
  expect(
    selectDetail({
      inbox: inbox([], ['th_01']),
      threadId: null,
      reviewId: undefined,
      invalidPath: false,
      policy: pm,
    }).kind,
  ).toBe('choose')
})
