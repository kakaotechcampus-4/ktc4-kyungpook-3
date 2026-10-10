import { uploadReturnTarget } from './uploadReturn'

describe('Notion 연결 뒤 복귀 목적지 (U3-2)', () => {
  it('그 공간의 업로드 경로만 받는다', () => {
    expect(uploadReturnTarget('ws_01', '/workspaces/ws_01/meetings/upload')).toBe(
      '/workspaces/ws_01/meetings/upload',
    )
  })

  it.each([
    ['외부 주소', 'https://evil.example/workspaces/ws_01/meetings/upload'],
    ['프로토콜 상대 주소', '//evil.example/workspaces/ws_01/meetings/upload'],
    ['역슬래시 우회', '/\\evil.example'],
    ['다른 공간의 업로드', '/workspaces/ws_02/meetings/upload'],
    ['같은 공간의 다른 화면', '/workspaces/ws_01/tasks'],
    ['상위 경로 우회', '/workspaces/ws_02/../ws_01/meetings/upload/../../tasks'],
    ['검색이 붙은 업로드', '/workspaces/ws_01/meetings/upload?next=https://evil.example'],
    ['해시가 붙은 업로드', '/workspaces/ws_01/meetings/upload#x'],
    ['상대 경로', 'meetings/upload'],
    ['javascript 주소', 'javascript:alert(1)'],
    ['빈 값', ''],
  ])('%s 는 거부한다', (_, raw) => {
    expect(uploadReturnTarget('ws_01', raw)).toBeNull()
  })

  it('값이 없으면 null 이다', () => {
    expect(uploadReturnTarget('ws_01', null)).toBeNull()
  })

  it('상위 경로를 풀어 같은 업로드 경로가 되면 받는다 — 비교는 정규화한 경로로 한다', () => {
    expect(uploadReturnTarget('ws_01', '/workspaces/ws_02/../ws_01/meetings/upload')).toBe(
      '/workspaces/ws_01/meetings/upload',
    )
  })
})
