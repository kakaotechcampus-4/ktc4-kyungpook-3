import {
  clearTrackedMeetings,
  finishMeeting,
  trackMeeting,
  untrackMeeting,
  useMeetingTrackerStore,
} from './processingTracker'

const tracked = () => useMeetingTrackerStore.getState().meetings

afterEach(() => clearTrackedMeetings())

describe('정리 추적 대상 등록 지점', () => {
  it('업로드가 받은 회의를 공간과 함께 등록한다', () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    expect(tracked()).toEqual([{ workspaceId: 'ws_01', meetingId: 'mt_11' }])
  })

  it('같은 회의는 한 번만 둔다 — 상태 객체도 바꾸지 않는다', () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    const before = useMeetingTrackerStore.getState()
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    expect(useMeetingTrackerStore.getState()).toBe(before)
  })

  it('공간이 다르면 다른 항목이다', () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    trackMeeting({ workspaceId: 'ws_04', meetingId: 'mt_11' })
    expect(tracked()).toHaveLength(2)
  })

  it('빼기와 모두 비우기', () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_12' })
    untrackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    expect(tracked()).toEqual([{ workspaceId: 'ws_01', meetingId: 'mt_12' }])
    clearTrackedMeetings()
    expect(tracked()).toEqual([])
  })

  it('ID 만 갖는다 — 회의 객체(제목·상태)를 담지 않는다 (G5)', () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_11' })
    expect(Object.keys(tracked()[0]).sort()).toEqual(['meetingId', 'workspaceId'])
  })
})

describe('추적 끝내기 (U4-5)', () => {
  const meeting = { workspaceId: 'ws_01', meetingId: 'mt_11' }

  it('처음 끝낼 때만 true 다 — 두 번째 호출은 아무것도 하지 않는다', () => {
    trackMeeting(meeting)
    expect(finishMeeting(meeting)).toBe(true)
    expect(tracked()).toEqual([])
    const before = useMeetingTrackerStore.getState()
    expect(finishMeeting(meeting)).toBe(false)
    expect(useMeetingTrackerStore.getState()).toBe(before)
  })

  it('끝낸 회의는 다시 등록되지 않는다 — 낡은 목록이 정리 중으로 보여 줘도', () => {
    trackMeeting(meeting)
    finishMeeting(meeting)
    trackMeeting(meeting)
    expect(tracked()).toEqual([])
    // 다른 공간의 같은 ID 는 다른 회의다
    trackMeeting({ workspaceId: 'ws_04', meetingId: 'mt_11' })
    expect(tracked()).toEqual([{ workspaceId: 'ws_04', meetingId: 'mt_11' }])
  })

  it('로그아웃(모두 비우기)은 끝낸 기록도 지운다 — 다음 사용자는 처음부터다', () => {
    finishMeeting(meeting)
    clearTrackedMeetings()
    expect(useMeetingTrackerStore.getState()).toEqual({ meetings: [], finished: [] })
    trackMeeting(meeting)
    expect(tracked()).toEqual([meeting])
  })
})
