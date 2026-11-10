import {
  clearTrackedMeetings,
  dismissProcessingToast,
  dismissSettled,
  finishMeeting,
  promptSpeakers,
  settleMeeting,
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
    expect(useMeetingTrackerStore.getState()).toEqual({
      meetings: [],
      finished: [],
      prompted: [],
      settled: [],
      dismissed: [],
    })
    trackMeeting(meeting)
    expect(tracked()).toEqual([meeting])
  })
})

describe('진행 알림 숨기기 (#614)', () => {
  const meeting = { workspaceId: 'ws_01', meetingId: 'mt_11' }

  it('추적과 안내·결과를 보존하고 같은 알림을 두 번 닫아도 상태는 그대로다', () => {
    trackMeeting(meeting)
    promptSpeakers(meeting)
    const before = useMeetingTrackerStore.getState()
    dismissProcessingToast(meeting)
    const after = useMeetingTrackerStore.getState()
    expect(after).toEqual({ ...before, dismissed: ['ws_01/mt_11'] })
    expect(after.meetings).toBe(before.meetings)
    expect(after.prompted).toBe(before.prompted)
    expect(after.finished).toBe(before.finished)
    expect(after.settled).toBe(before.settled)
    dismissProcessingToast(meeting)
    expect(useMeetingTrackerStore.getState()).toBe(after)
  })

  it('추적하지 않거나 끝난 회의는 숨김 기록을 만들지 않는다', () => {
    const before = useMeetingTrackerStore.getState()
    dismissProcessingToast(meeting)
    expect(useMeetingTrackerStore.getState()).toBe(before)
    trackMeeting(meeting)
    finishMeeting(meeting)
    dismissProcessingToast(meeting)
    expect(useMeetingTrackerStore.getState().dismissed).toEqual([])
  })

  it('공간이 다른 같은 회의 ID는 따로 숨기며 세션을 비우면 다시 보일 수 있다', () => {
    const other = { ...meeting, workspaceId: 'ws_04' }
    trackMeeting(meeting)
    trackMeeting(other)
    dismissProcessingToast(meeting)
    expect(useMeetingTrackerStore.getState().dismissed).toEqual(['ws_01/mt_11'])
    dismissProcessingToast(other)
    expect(useMeetingTrackerStore.getState().dismissed).toEqual(['ws_01/mt_11', 'ws_04/mt_11'])
    clearTrackedMeetings()
    expect(useMeetingTrackerStore.getState().dismissed).toEqual([])
    trackMeeting(meeting)
    dismissProcessingToast(meeting)
    expect(useMeetingTrackerStore.getState().dismissed).toEqual(['ws_01/mt_11'])
  })
})

describe('화자 지정 안내 (#256)', () => {
  const meeting = { workspaceId: 'ws_01', meetingId: 'mt_11' }

  it('회의마다 처음 한 번만 true 이고 추적은 그대로다', () => {
    trackMeeting(meeting)
    expect(promptSpeakers(meeting)).toBe(true)
    expect(promptSpeakers(meeting)).toBe(false)
    expect(promptSpeakers({ workspaceId: 'ws_04', meetingId: 'mt_11' })).toBe(true)
    expect(tracked()).toEqual([meeting])
  })

  it('세션을 비우면 다시 안내할 수 있다', () => {
    promptSpeakers(meeting)
    clearTrackedMeetings()
    expect(promptSpeakers(meeting)).toBe(true)
  })
})

describe('끝난 결과 (#424)', () => {
  const meeting = { workspaceId: 'ws_01', meetingId: 'mt_11' }
  const settled = () => useMeetingTrackerStore.getState().settled

  it('같은 회의의 결과는 하나만 두고 나중 결과로 바꾼다', () => {
    settleMeeting({ ...meeting, title: '주간 회의', outcome: 'failed', failedStage: null })
    settleMeeting({ ...meeting, title: '주간 회의', outcome: 'done' })
    settleMeeting({ workspaceId: 'ws_04', meetingId: 'mt_11', title: '다른 공간', outcome: 'done' })
    expect(settled()).toEqual([
      { ...meeting, title: '주간 회의', outcome: 'done' },
      { workspaceId: 'ws_04', meetingId: 'mt_11', title: '다른 공간', outcome: 'done' },
    ])
  })

  it('공간마다 가장 최근 결과 하나만 남는다 — 닫지 않고 이어 정리해도 쌓이지 않는다', () => {
    for (const meetingId of ['mt_11', 'mt_12', 'mt_13'])
      settleMeeting({ workspaceId: 'ws_01', meetingId, title: meetingId, outcome: 'done' })
    settleMeeting({ workspaceId: 'ws_04', meetingId: 'mt_20', title: '다른 공간', outcome: 'done' })
    settleMeeting({
      workspaceId: 'ws_01',
      meetingId: 'mt_14',
      title: 'mt_14',
      outcome: 'failed',
      failedStage: null,
    })
    expect(settled()).toEqual([
      { workspaceId: 'ws_04', meetingId: 'mt_20', title: '다른 공간', outcome: 'done' },
      {
        workspaceId: 'ws_01',
        meetingId: 'mt_14',
        title: 'mt_14',
        outcome: 'failed',
        failedStage: null,
      },
    ])
  })

  it('닫으면 그 회의만 빠지고, 없는 회의를 닫아도 상태 객체는 그대로다', () => {
    settleMeeting({ ...meeting, title: '주간 회의', outcome: 'done' })
    settleMeeting({ workspaceId: 'ws_04', meetingId: 'mt_11', title: '다른 공간', outcome: 'done' })
    dismissSettled(meeting)
    expect(settled().map(({ workspaceId }) => workspaceId)).toEqual(['ws_04'])
    const before = useMeetingTrackerStore.getState()
    dismissSettled(meeting)
    expect(useMeetingTrackerStore.getState()).toBe(before)
  })

  it('세션을 비우면 결과도 지운다', () => {
    settleMeeting({ ...meeting, title: '주간 회의', outcome: 'done' })
    clearTrackedMeetings()
    expect(settled()).toEqual([])
  })
})
