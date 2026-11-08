import { paths } from '@/shared/config/routes'
import { safeReturnPath, withOAuthResult } from '@/shared/lib/oauth'
import { db } from '../db'
import { saveDb } from '../persistence'
import { accountWithEmail } from '../sessions'

const PROVIDER = 'kakao'

interface MockKakaoIdentity {
  id: string
  email: string | null
  emailVerified: boolean
  nickname: string | null
}

/* 픽스처 계정 pm@example.com 과의 관계로 callback 의 갈래를 재현한다 */
const NEW: MockKakaoIdentity = {
  id: 'kakao-new',
  email: 'kakao-new@example.com',
  emailVerified: true,
  nickname: '카카오 새 사용자',
}

const RETURNING: MockKakaoIdentity = {
  id: 'kakao-pm',
  email: 'pm@example.com',
  emailVerified: true,
  nickname: '최진호',
}

const NO_EMAIL: MockKakaoIdentity = {
  id: 'kakao-no-email',
  email: null,
  emailVerified: false,
  nickname: '이메일 없는 사용자',
}

const COLLISION: MockKakaoIdentity = {
  id: 'kakao-collision',
  email: 'pm@example.com',
  emailVerified: false,
  nickname: '남의 이메일',
}

export const MOCK_KAKAO_CHOICES = {
  new: { label: '새 사용자 (이메일 있음)', identity: NEW },
  returning: { label: '이어진 계정으로 로그인', identity: RETURNING },
  'no-email': { label: '새 사용자 (이메일 없음)', identity: NO_EMAIL },
  collision: { label: '이메일 충돌', identity: COLLISION },
} as const

export type MockKakaoChoice = keyof typeof MOCK_KAKAO_CHOICES | 'cancelled' | 'failed'

type Outcome = 'signed-in' | 'email-exists' | 'needs-signup'

/** 백엔드 `_kakao_outcome` 의 갈래. 위에서 아래로 먼저 맞는 것을 따른다 */
function settle(identity: MockKakaoIdentity): Outcome {
  const known = db.accounts.find(({ kakaoId }) => kakaoId === identity.id)
  const owner = known ?? (identity.email === null ? undefined : accountWithEmail(identity.email))
  if (owner === undefined) return 'needs-signup'
  if (known === undefined && (!identity.emailVerified || owner.kakaoId !== undefined))
    return 'email-exists'
  owner.kakaoId = identity.id
  db.session = structuredClone(owner.session)
  db.authenticated = true
  return 'signed-in'
}

/** 실 API 콜백이 할 일을 흉내내고 돌아갈 주소를 돌려준다. 곧 현재 탭을 옮기므로 여기서 저장한다 */
export function finishMockKakao(
  choice: MockKakaoChoice,
  next: string | null,
  storage: Storage,
): string {
  const returnPath = safeReturnPath(next) ?? undefined
  const login = paths.login(returnPath)
  let url: string
  if (choice === 'cancelled' || choice === 'failed') {
    url = withOAuthResult(login, PROVIDER, choice)
  } else {
    const { identity } = MOCK_KAKAO_CHOICES[choice]
    const outcome = settle(identity)
    if (outcome === 'signed-in') url = withOAuthResult(login, PROVIDER, 'success')
    else if (outcome === 'email-exists')
      url = withOAuthResult(login, PROVIDER, 'failed', 'email_exists')
    else {
      db.kakao.pending = {
        kakaoId: identity.id,
        email: identity.emailVerified ? identity.email : null,
        nickname: identity.nickname,
      }
      url = paths.signup({ kakao: true, next: returnPath })
    }
  }
  saveDb(storage)
  return url
}
