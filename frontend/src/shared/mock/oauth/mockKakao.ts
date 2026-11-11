import { paths } from '@/shared/config/routes'
import { safeReturnPath, withOAuthResult } from '@/shared/lib/oauth'
import { db } from '../db'
import { saveDb } from '../persistence'

const PROVIDER = 'kakao'

interface MockKakaoIdentity {
  id: string
  nickname: string | null
}

/* 카카오 이메일은 쓰지 않는다. 이어진 카카오 id 가 있으면 로그인, 없으면 가입이다 (#627) */
const NEW: MockKakaoIdentity = { id: 'kakao-new', nickname: '카카오 새 사용자' }

/** 픽스처 계정 pm@example.com 에 이어진 카카오. 병합을 없애기 전에 이어진 계정이다 */
const RETURNING: MockKakaoIdentity = { id: 'kakao-pm', nickname: '최진호' }

const NO_NICKNAME: MockKakaoIdentity = { id: 'kakao-no-nickname', nickname: null }

export const MOCK_KAKAO_CHOICES = {
  new: { label: '새 사용자', identity: NEW },
  returning: { label: '이어진 계정으로 로그인', identity: RETURNING },
  'no-nickname': { label: '새 사용자 (닉네임 없음)', identity: NO_NICKNAME },
} as const

export type MockKakaoChoice = keyof typeof MOCK_KAKAO_CHOICES | 'cancelled' | 'failed'

/** 백엔드 `_finish_kakao_login` 의 갈래. 카카오 id 로만 찾고 이메일로 잇지 않는다 */
function settle(identity: MockKakaoIdentity): 'signed-in' | 'needs-signup' {
  const known = db.accounts.find(({ kakaoId }) => kakaoId === identity.id)
  if (known === undefined) return 'needs-signup'
  db.session = structuredClone(known.session)
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
    // BE 는 로그인 복귀에서 대기 쿠키를 지운다. 앞서 멈춘 가입 대기가 다음 가입에 이어지지 않는다(계약 §4.1.4)
    if (settle(identity) === 'signed-in') {
      db.kakao.pending = null
      url = withOAuthResult(login, PROVIDER, 'success')
    } else {
      db.kakao.pending = { kakaoId: identity.id, nickname: identity.nickname }
      url = paths.signup({ kakao: true, next: returnPath })
    }
  }
  saveDb(storage)
  return url
}
