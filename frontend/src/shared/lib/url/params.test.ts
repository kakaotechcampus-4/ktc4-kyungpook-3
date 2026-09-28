import { parseEnumParam, parseRouteId } from './params'

describe('parseRouteId', () => {
  it.each(['ws_01', 'ap_01', 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'])('%s 는 ID 다', (value) => {
    expect(parseRouteId(value)).toBe(value)
  })

  it.each([undefined, '', 'a b', '../ws_01', 'ws_01/tasks', 'ws.01', 'x'.repeat(65)])(
    '%s 는 ID 가 아니다',
    (value) => {
      expect(parseRouteId(value)).toBeNull()
    },
  )
})

describe('parseEnumParam', () => {
  const steps = ['create_workspace', 'connect_notion'] as const

  it('정해진 값이면 그대로 돌려준다', () => {
    expect(parseEnumParam('connect_notion', steps)).toBe('connect_notion')
  })

  it('아니면 null 이다', () => {
    expect(parseEnumParam('future_step', steps)).toBeNull()
    expect(parseEnumParam(undefined, steps)).toBeNull()
  })
})
