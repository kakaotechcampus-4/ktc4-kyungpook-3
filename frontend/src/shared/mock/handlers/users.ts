import { http } from 'msw'
import type { UserSummaryDto } from '@/shared/types/api/invitation'
import { requireAuth, requirePmRole } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { accountWithUsername, isMemberOf } from '../sessions'
import { readJson } from '../utils'
import { checkedUsername, invalidBody, usernameField } from '../validation'
import type { FieldError } from '../validation'

const queryField = (url: URL, name: string): FieldError | null =>
  url.searchParams.has(name) ? null : { loc: ['query', name], msg: 'Field required' }

/** 로그인한 사용자의 계정 정보 변경 (#627)과 초대할 가입자 찾기 (#628). BE api/users.py */
export const userHandlers = [
  http.patch('/api/v1/users/me', async ({ request }) => {
    const denied = requireAuth()
    if (denied) return denied
    const body = (await readJson(request)) ?? {}
    const bodyError = invalidBody(usernameField(body, 'username'))
    if (bodyError) return bodyError
    const username = checkedUsername(body.username as string) as string
    const { user } = db.session
    // 지금 아이디와 같으면 그대로 200 이다. 중복 확인은 내 아이디도 taken 이라 화면이 먼저 비교한다
    if (username !== user.username) {
      if (accountWithUsername(username) || db.usernameRace.includes(username))
        return fail('USERNAME_TAKEN', '이미 사용 중인 아이디입니다.', 409)
      user.username = username
      const account = db.accounts.find(({ session }) => session.user.user_id === user.user_id)
      if (account) account.session.user.username = username
    }
    return ok(user)
  }),
  // 아이디가 대소문자만 빼고 같아야 나온다. 앞부분·이름으로는 찾지 않는다. 그 공간 팀원은 빠지고, 탈퇴한 계정은 행이 없다
  http.get('/api/v1/users/search', ({ request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const url = new URL(request.url)
    const queryError = invalidBody(queryField(url, 'workspace_id'), queryField(url, 'q'))
    if (queryError) return queryError
    const workspaceId = url.searchParams.get('workspace_id') ?? ''
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const username = checkedUsername(url.searchParams.get('q') ?? '')
    const found = username === null ? undefined : accountWithUsername(username)
    const items: UserSummaryDto[] =
      found && !isMemberOf(workspaceId, found.session.user.user_id)
        ? [
            {
              user_id: found.session.user.user_id,
              username: found.session.user.username,
              name: found.session.user.name,
            },
          ]
        : []
    return ok({ items })
  }),
]
