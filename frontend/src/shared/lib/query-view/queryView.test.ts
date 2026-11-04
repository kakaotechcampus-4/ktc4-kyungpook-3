import { queryView } from './queryView'

describe('queryView — 조회의 화면 상태 (E-02)', () => {
  const failure = new Error('boom')

  it.each([
    ['데이터·오류 없음', { data: undefined, error: null }, 'loading'],
    ['처음부터 실패', { data: undefined, error: failure }, 'error'],
    ['성공', { data: [], error: null }, 'ready'],
    ['데이터는 있고 재조회 실패', { data: [], error: failure }, 'refreshFailed'],
  ] as const)('%s → %s', (_, query, expected) => {
    expect(queryView(query)).toBe(expected)
  })

  it('null 데이터도 받은 데이터다. 오류 칸이 undefined 여도 실패가 아니다', () => {
    expect(queryView({ data: null, error: undefined })).toBe('ready')
  })
})
