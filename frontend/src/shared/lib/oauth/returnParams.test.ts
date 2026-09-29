import { readOAuthResult, safeReturnPath, withOAuthResult } from './returnParams'

describe('safeReturnPath', () => {
  it('앱 안 경로는 그대로 받는다', () => {
    expect(safeReturnPath('/onboarding/ws_03/connect_discord')).toBe(
      '/onboarding/ws_03/connect_discord',
    )
    expect(safeReturnPath('/a?b=1#c')).toBe('/a?b=1#c')
  })

  it.each([null, undefined, '', 'onboarding', 'https://evil.example', '//evil.example', '/\\evil'])(
    '밖으로 나가는 주소 %s 는 버린다',
    (value) => {
      expect(safeReturnPath(value)).toBeNull()
    },
  )
})

describe('withOAuthResult · readOAuthResult', () => {
  it('복귀 경로에 결과를 붙이고 다시 읽는다. 원래 검색 파라미터는 남긴다', () => {
    const url = withOAuthResult('/onboarding/ws_03/connect_discord?x=1', 'discord', 'cancelled')
    expect(url).toBe('/onboarding/ws_03/connect_discord?x=1&oauth=discord&oauth_result=cancelled')
    expect(readOAuthResult(new URL(url, location.origin).searchParams)).toEqual({
      provider: 'discord',
      outcome: 'cancelled',
    })
  })

  it('모르는 결과는 null 이다', () => {
    expect(readOAuthResult(new URLSearchParams({ oauth: 'discord', oauth_result: 'x' }))).toBeNull()
  })
})
