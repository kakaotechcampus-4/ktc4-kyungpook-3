import { fetchDto } from '@/shared/test/api'
import { db } from '../db'
import { MOCK_DB_STORAGE_KEY } from '../persistence'
import { applyScenario } from '../scenarios'
import { finishMockKakao } from './mockKakao'

/* #427·#627 모의 카카오. backend `_finish_kakao_login` 의 갈래를 본다 */

const NEXT = '/workspaces/ws_01/tasks'

const finish = (choice: Parameters<typeof finishMockKakao>[0], next: string | null = NEXT) =>
  finishMockKakao(choice, next, sessionStorage)

beforeEach(() => {
  applyScenario('signed-out')
})

afterEach(() => {
  sessionStorage.clear()
})

it('새 사용자: 카카오 신원을 대기로 두고 next 를 들고 가입 화면으로 간다. 이메일은 담지 않는다', async () => {
  expect(finish('new')).toBe('/signup?kakao=1&next=%2Fworkspaces%2Fws_01%2Ftasks')
  await expect(fetchDto('/auth/kakao/pending')).resolves.toEqual({
    nickname: '카카오 새 사용자',
  })
  expect(db.authenticated).toBe(false)
})

it('닉네임이 없는 사용자: 대기의 닉네임이 null 이다', async () => {
  expect(finish('no-nickname', null)).toBe('/signup?kakao=1')
  await expect(fetchDto('/auth/kakao/pending')).resolves.toEqual({ nickname: null })
})

it('이어진 카카오는 그 계정으로 로그인시킨다', () => {
  expect(finish('returning')).toBe(
    '/login?next=%2Fworkspaces%2Fws_01%2Ftasks&oauth=kakao&oauth_result=success',
  )
  expect(db.authenticated).toBe(true)
  expect(db.session.user.email).toBe('pm@example.com')
})

it('이메일이 같아도 잇지 않는다. 이어진 카카오가 없으면 가입 화면이다 (#627)', () => {
  db.accounts[0].kakaoId = undefined
  expect(finish('returning', null)).toBe('/signup?kakao=1')
  expect(db.authenticated).toBe(false)
  expect(db.accounts[0].kakaoId).toBeUndefined()
  expect(db.kakao.pending).toEqual({ kakaoId: 'kakao-pm', nickname: '최진호' })
})

it.each(['cancelled', 'failed'] as const)('%s 는 next 를 들고 로그인으로 돌아간다', (choice) => {
  expect(finish(choice)).toBe(
    `/login?next=%2Fworkspaces%2Fws_01%2Ftasks&oauth=kakao&oauth_result=${choice}`,
  )
})

it('로그인 복귀는 앞서 멈춘 가입 대기를 지운다 (BE 대기 쿠키 삭제)', async () => {
  finish('new')
  expect(finish('returning', null)).toBe('/login?oauth=kakao&oauth_result=success')
  expect(db.kakao.pending).toBeNull()
  await expect(fetchDto('/auth/kakao/pending')).rejects.toMatchObject({
    code: 'KAKAO_LINK_EXPIRED',
  })
  const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
    db: typeof db
  }
  expect(stored.db.kakao.pending).toBeNull()
})

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
