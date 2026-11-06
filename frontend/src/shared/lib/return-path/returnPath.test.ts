import { parseReturnPath } from './returnPath'

describe('parseReturnPath', () => {
  it.each([
    '/workspaces/ws_01/messages/threads/th_1',
    '/workspaces/ws_01/tasks/t_1',
    '/workspaces/ws_01/messages?review=b_1',
    '/workspaces',
    '/onboarding/ws_01/connect_notion',
  ])('앱 안 보호 경로 %s 는 그대로 받는다', (raw) => {
    expect(parseReturnPath(raw)).toBe(raw)
  })

  it.each([
    ['/workspaces/ws_01/./tasks', '/workspaces/ws_01/tasks'],
    ['/workspaces/ws_01/meetings/../tasks/t_1', '/workspaces/ws_01/tasks/t_1'],
    ['/workspaces/ws_01/tasks#detail', '/workspaces/ws_01/tasks#detail'],
  ])('%s 는 %s 로 정규화한다', (raw, normalized) => {
    expect(parseReturnPath(raw)).toBe(normalized)
  })

  it.each([
    ['프로토콜 상대 주소', '//evil.com'],
    ['역슬래시', '/\\evil.com'],
    ['역슬래시 두 개', '/\\\\evil.com'],
    ['절대 주소', 'https://evil.com'],
    ['슬래시 없는 스킴', 'http:evil.com'],
    ['javascript', 'javascript:alert(1)'],
    ['인코딩한 //', '/%2F%2Fevil.com'],
    ['/ 로 시작하지 않음', '%2F%2Fevil.com'],
    ['인코딩한 역슬래시', '/%5Cevil.com'],
    ['경로 안의 인코딩한 //', '/workspaces/%2F%2Fevil.com'],
    ['두 번 인코딩한 //', '/%252F%252Fevil.com'],
    ['점 경로로 빠져나감', '/workspaces/../login'],
    ['인코딩한 점 경로로 빠져나감', '/workspaces/%2e%2e/login'],
    ['로그인', '/login'],
    ['회원가입', '/signup'],
    ['랜딩', '/'],
    ['비밀번호 찾기', '/forgot-password'],
    ['비밀번호 재설정', '/reset-password'],
    ['모의 화면', '/__mock/mail'],
    ['줄바꿈', '/workspaces/ws_01\n/tasks'],
    ['탭', '/\t/evil.com'],
    ['인코딩한 줄바꿈', '/workspaces/ws_01%0a'],
    ['인코딩한 NUL', '/workspaces/ws_01%00'],
    ['인코딩한 DEL', '/workspaces/ws_01%7f'],
    ['잘못된 인코딩', '/workspaces/%E0%A4%A'],
    ['빈 값', ''],
    ['너무 긴 값', `/workspaces/${'a'.repeat(2048)}`],
  ])('%s(%j) 는 버린다', (_label, raw) => {
    expect(parseReturnPath(raw)).toBeNull()
  })

  it('값이 없으면 null', () => {
    expect(parseReturnPath(null)).toBeNull()
  })
})
