import { fitAttendees } from './fitAttendees'

const GAP = 6
const MORE = 30

describe('fitAttendees — 참석자 줄 한 줄에 보일 이름 칩 수 (UX1-M03)', () => {
  it('모두 들어가면 모두 보이고 `+N` 자리를 남기지 않는다', () => {
    // 50 + 6 + 50 + 6 + 50 = 162 — 딱 맞는 폭이면 마지막 칩 대신 `+1` 을 두지 않는다
    expect(fitAttendees([50, 50, 50], 162, GAP, MORE)).toBe(3)
    expect(fitAttendees([50], 50, GAP, MORE)).toBe(1)
    expect(fitAttendees([], 0, GAP, MORE)).toBe(0)
  })

  it('넘치면 `+N` 칩 자리(간격 + 폭)를 남기는 데까지만 넣는다', () => {
    // 50 · 50 · 50 · 50 (218) 이 161 에 안 들어간다. 두 칩 106 + 6 + 30 = 142 ≤ 161, 세 칩 162 + 36 = 198 > 161
    expect(fitAttendees([50, 50, 50, 50], 161, GAP, MORE)).toBe(2)
    // 경계 — 두 칩과 `+N` 이 꼭 맞는다
    expect(fitAttendees([50, 50, 50, 50], 142, GAP, MORE)).toBe(2)
    expect(fitAttendees([50, 50, 50, 50], 141, GAP, MORE)).toBe(1)
  })

  it('폭이 서로 다른 칩도 순서대로 넣는다 — 뒤의 짧은 칩으로 건너뛰지 않는다', () => {
    expect(fitAttendees([40, 120, 30, 30], 120, GAP, MORE)).toBe(1)
  })

  it('첫 칩과 `+N` 도 안 들어가면 `+N` 만 남는다', () => {
    expect(fitAttendees([80, 80], 100, GAP, MORE)).toBe(0)
  })

  it('잴 수 없는 환경(폭이 모두 0)에서는 모두 보인다', () => {
    expect(fitAttendees([0, 0, 0, 0], 0, 0, 0)).toBe(4)
  })
})
