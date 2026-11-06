import type { Invitation, InvitationStatus } from '@/entities/invitation'
import { memberInviteView } from './inviteView'

function latest(status: InvitationStatus, acceptedUser: Invitation['acceptedUser'] = null) {
  return {
    id: 'iv_01',
    memberId: 'mb_03',
    email: 'jaehwan@example.com',
    status,
    acceptedUser,
    createdAt: '2026-09-16T09:00:00Z',
  } satisfies Invitation
}

const account = { userId: 'us_02', name: '이재환', email: 'jaehwan@example.com' }

describe('memberInviteView', () => {
  it('초대한 적 없는 팀원은 초대만 할 수 있다', () => {
    expect(memberInviteView('member', null)).toEqual({
      chip: null,
      detail: null,
      invite: '초대',
      close: null,
    })
  })

  it.each([
    ['pending', '대기', 'waiting', { kind: 'cancel', invitationId: 'iv_01' }],
    ['declined', '거절', 'signal', null],
    ['canceled', '취소', 'closed', null],
    ['revoked', '연결 끊김', 'closed', null],
  ] as const)(
    '%s 는 %s 칩과 초대 이메일을 보이고 다시 초대할 수 있다',
    (status, label, tone, close) => {
      expect(memberInviteView('member', latest(status, account))).toEqual({
        chip: { label, tone },
        detail: 'jaehwan@example.com',
        invite: '다시 초대',
        close,
      })
    },
  )

  it('수락은 수락한 계정과 연결 끊기를 보이고 초대하지 않는다', () => {
    expect(
      memberInviteView('member', latest('accepted', { ...account, email: 'jh.lee@example.com' })),
    ).toEqual({
      chip: { label: '수락', tone: 'linked' },
      detail: '이재환 · jh.lee@example.com',
      invite: null,
      close: { kind: 'revoke', invitationId: 'iv_01' },
    })
  })

  it('수락한 계정이 지워졌으면 초대 이메일만 보인다', () => {
    expect(memberInviteView('member', latest('accepted'))).toMatchObject({
      detail: 'jaehwan@example.com',
      close: { kind: 'revoke' },
    })
  })

  it('PM 팀원은 수락한 뒤 PM 이 된 경우만 계정과 연결 끊기를 보인다', () => {
    expect(memberInviteView('pm', latest('accepted', account))).toEqual({
      chip: { label: '수락', tone: 'linked' },
      detail: '이재환 · jaehwan@example.com',
      invite: null,
      close: { kind: 'revoke', invitationId: 'iv_01' },
    })
    expect(memberInviteView('pm', null)).toBeNull()
    for (const status of ['pending', 'declined', 'canceled', 'revoked'] as const)
      expect(memberInviteView('pm', latest(status, account)), status).toBeNull()
  })
})
