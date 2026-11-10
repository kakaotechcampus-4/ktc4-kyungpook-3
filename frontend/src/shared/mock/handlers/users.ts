import { http } from 'msw'
import { requireAuth } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { accountWithUsername } from '../sessions'
import { readJson } from '../utils'
import { checkedUsername, invalidBody, usernameField } from '../validation'

/** 로그인한 사용자의 계정 정보 변경 (#627, BE api/users.py). 지금은 아이디만 바꾼다 */
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
]
