import { QueryClient } from '@tanstack/react-query'
import { sessionQueryOptions } from '../api/session'
import { captureAccountIntro, isDeviceIntroSeen, markDeviceIntroSeen } from './introRecord'
import { advanceSessionGeneration } from './sessionGeneration'
import type { Session } from './types'

function signedIn(userId: string | null): QueryClient {
  const queryClient = new QueryClient()
  const session: Session | null =
    userId === null
      ? null
      : {
          user: { id: userId, email: `${userId}@example.com`, name: userId, avatarUrl: null },
          workspaceCount: 1,
          lastWorkspaceId: null,
        }
  queryClient.setQueryData(sessionQueryOptions().queryKey, session)
  return queryClient
}

const throwing = () => {
  throw new DOMException('blocked', 'SecurityError')
}

afterEach(() => vi.restoreAllMocks())

describe('기기 인트로 기록 (#430)', () => {
  it('처음에는 보지 않았고, 적으면 본 것이다', () => {
    expect(isDeviceIntroSeen()).toBe(false)
    markDeviceIntroSeen()
    expect(isDeviceIntroSeen()).toBe(true)
  })

  it('읽지 못하면 보지 않은 것으로 보고, 쓰지 못해도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing)
    expect(isDeviceIntroSeen()).toBe(false)
    expect(() => markDeviceIntroSeen()).not.toThrow()
  })
})

describe('계정 인트로 기록 (#430)', () => {
  it('비로그인이면 기록이 없다', () => {
    expect(captureAccountIntro(signedIn(null))).toBeNull()
  })

  it('신호가 없으면 볼 차례가 아니다. 신호를 받으면 볼 차례이고 닫으면 끝난다', () => {
    const queryClient = signedIn('us_01')
    expect(captureAccountIntro(queryClient)?.isDue()).toBe(false)

    captureAccountIntro(queryClient)?.markPending()
    const opened = captureAccountIntro(queryClient)
    expect(opened?.isDue()).toBe(true)

    opened?.markSeen()
    expect(captureAccountIntro(queryClient)?.isDue()).toBe(false)
  })

  it('이미 닫은 계정은 신호를 다시 받아도 볼 차례가 되지 않는다', () => {
    const queryClient = signedIn('us_01')
    captureAccountIntro(queryClient)?.markPending()
    captureAccountIntro(queryClient)?.markSeen()

    captureAccountIntro(queryClient)?.markPending()
    expect(captureAccountIntro(queryClient)?.isDue()).toBe(false)
  })

  it('계정마다 따로 센다', () => {
    captureAccountIntro(signedIn('us_01'))?.markPending()
    expect(captureAccountIntro(signedIn('us_02'))?.isDue()).toBe(false)
    expect(captureAccountIntro(signedIn('us_01'))?.isDue()).toBe(true)
  })

  it('잡아 둔 뒤 세션이 끝나거나 바뀌면 그 계정 키에 쓰지 않는다', () => {
    const queryClient = signedIn('us_01')
    captureAccountIntro(queryClient)?.markPending()
    const opened = captureAccountIntro(queryClient)
    const signal = captureAccountIntro(signedIn('us_03'))

    advanceSessionGeneration()
    opened?.markSeen()
    signal?.markPending()

    expect(captureAccountIntro(queryClient)?.isDue()).toBe(true)
    expect(captureAccountIntro(signedIn('us_03'))?.isDue()).toBe(false)
  })

  it('읽지 못하면 볼 차례가 아니고, 쓰지 못해도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing)
    const intro = captureAccountIntro(signedIn('us_01'))
    expect(intro?.isDue()).toBe(false)
    expect(() => intro?.markPending()).not.toThrow()
    expect(() => intro?.markSeen()).not.toThrow()
  })
})
