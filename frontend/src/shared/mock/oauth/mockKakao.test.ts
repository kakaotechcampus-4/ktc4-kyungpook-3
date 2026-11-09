import { fetchDto } from '@/shared/test/api'
import { db } from '../db'
import { MOCK_DB_STORAGE_KEY } from '../persistence'
import { applyScenario } from '../scenarios'
import { finishMockKakao } from './mockKakao'

/* #427 모의 카카오. backend `_finish_kakao_login` 의 갈래를 본다 */

const NEXT = '/workspaces/ws_01/tasks'

const finish = (choice: Parameters<typeof finishMockKakao>[0], next: string | null = NEXT) =>
  finishMockKakao(choice, next, sessionStorage)

beforeEach(() => {
  applyScenario('signed-out')
})

afterEach(() => {
  sessionStorage.clear()
})

it('새 사용자: 인증된 이메일을 대기로 두고 next 를 들고 가입 화면으로 간다', async () => {
  expect(finish('new')).toBe('/signup?kakao=1&next=%2Fworkspaces%2Fws_01%2Ftasks')
  await expect(fetchDto('/auth/kakao/pending')).resolves.toEqual({
    email: 'kakao-new@example.com',
    nickname: '카카오 새 사용자',
  })
  expect(db.authenticated).toBe(false)
})

it('이메일 없는 사용자: 대기의 이메일이 null 이다', async () => {
  expect(finish('no-email', null)).toBe('/signup?kakao=1')
  await expect(fetchDto('/auth/kakao/pending')).resolves.toEqual({
    email: null,
    nickname: '이메일 없는 사용자',
  })
})

it('인증된 이메일이 기존 계정과 같으면 그 계정에 잇고 로그인시킨다. 다음에는 카카오 id 로 찾는다', () => {
  expect(finish('returning')).toBe(
    '/login?next=%2Fworkspaces%2Fws_01%2Ftasks&oauth=kakao&oauth_result=success',
  )
  expect(db.authenticated).toBe(true)
  expect(db.session.user.email).toBe('pm@example.com')
  expect(db.accounts[0].kakaoId).toBe('kakao-pm')

  db.authenticated = false
  expect(finish('returning', null)).toBe('/login?oauth=kakao&oauth_result=success')
  expect(db.authenticated).toBe(true)
})

it('인증되지 않은 이메일이 기존 계정과 같으면 잇지 않고 email_exists 다', () => {
  expect(finish('collision', null)).toBe(
    '/login?oauth=kakao&oauth_result=failed&oauth_reason=email_exists',
  )
  expect(db.authenticated).toBe(false)
  expect(db.accounts[0].kakaoId).toBeUndefined()
})

it('다른 카카오에 이어진 계정은 덮어쓰지 않고 email_exists 다', () => {
  db.accounts[0].kakaoId = 'kakao-other'
  expect(finish('returning', null)).toBe(
    '/login?oauth=kakao&oauth_result=failed&oauth_reason=email_exists',
  )
  expect(db.accounts[0].kakaoId).toBe('kakao-other')
})

it.each(['cancelled', 'failed'] as const)('%s 는 next 를 들고 로그인으로 돌아간다', (choice) => {
  expect(finish(choice)).toBe(
    `/login?next=%2Fworkspaces%2Fws_01%2Ftasks&oauth=kakao&oauth_result=${choice}`,
  )
})

it.each([
  ['returning', 'success'],
  ['collision', 'failed&oauth_reason=email_exists'],
] as const)(
  '%s 복귀는 앞서 멈춘 가입 대기를 지운다 (BE 대기 쿠키 삭제)',
  async (choice, result) => {
    finish('new')
    expect(finish(choice, null)).toBe(`/login?oauth=kakao&oauth_result=${result}`)
    expect(db.kakao.pending).toBeNull()
    await expect(fetchDto('/auth/kakao/pending')).rejects.toMatchObject({
      code: 'KAKAO_LINK_EXPIRED',
    })
    const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
      db: typeof db
    }
    expect(stored.db.kakao.pending).toBeNull()
  },
)

it.each(['cancelled', 'failed'] as const)('%s 는 가입 대기를 그대로 둔다', (choice) => {
  finish('new')
  finish(choice, null)
  expect(db.kakao.pending).toMatchObject({ kakaoId: 'kakao-new' })
})

it('앱 밖 next 는 버린다', () => {
  expect(finish('cancelled', 'https://evil.example')).toBe(
    '/login?oauth=kakao&oauth_result=cancelled',
  )
})

it('현재 탭을 옮기기 전에 저장한다', () => {
  finish('new')
  const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
    db: typeof db
  }
  expect(stored.db.kakao.pending).toMatchObject({ kakaoId: 'kakao-new' })
})
