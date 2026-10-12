import { create } from 'zustand'

/** 정리를 지켜볼 회의 하나. 공간이 바뀌어도 끝날 때까지 따라가려고 공간 ID 를 함께 둔다 (U4) */
export interface TrackedMeeting {
  workspaceId: string
  meetingId: string
}

interface MeetingTrackerState {
  /** 등록한 순서. 같은 회의는 한 번만 있다 */
  meetings: readonly TrackedMeeting[]
  /**
   * 추적을 끝낸 회의(`공간/회의` key). 완료·실패·접근 상실을 한 번만 처리하려고 남긴다 —
   * 끝난 뒤 낡은 목록 캐시가 같은 회의를 다시 「정리 중」으로 보여 줘도 다시 등록하지 않는다 (U4-5)
   */
  finished: readonly string[]
}

/*
 * 정리 추적 대상 ID 목록. 서버 데이터가 아니라 「무엇을 지켜볼지」라는 화면 상태라 Zustand 에 둔다 (D-110, G5).
 * 회의 객체는 넣지 않는다 — 상태·진행은 Query 의 상세 캐시가 갖는다. persist 하지 않는다 (D-147):
 * 새로고침하면 현재 공간 목록에서 처리 중 회의를 다시 찾는다.
 *
 * 업로드(features)가 202 응답의 회의를 여기 등록하고, 앱 계층의 추적기(U4)가 읽는다.
 * entities 에 둔 것은 FSD 에서 features 와 app 이 함께 import 할 수 있는 가장 낮은 자리이기 때문이다 —
 * feature 끼리, widget 끼리 서로 부르지 않는다 (G4). 근거: docs/impl-decision/2026-10-02-meeting-upload-screen.md
 */
export const useMeetingTrackerStore = create<MeetingTrackerState>()(() => ({
  meetings: [],
  finished: [],
}))

function isSame(a: TrackedMeeting, b: TrackedMeeting): boolean {
  return a.workspaceId === b.workspaceId && a.meetingId === b.meetingId
}

function keyOf({ workspaceId, meetingId }: TrackedMeeting): string {
  return `${workspaceId}/${meetingId}`
}

/** 정리를 지켜볼 회의를 등록한다. 이미 있거나 이미 끝낸 회의면 그대로다 */
export function trackMeeting(meeting: TrackedMeeting): void {
  useMeetingTrackerStore.setState((state) =>
    state.meetings.some((item) => isSame(item, meeting)) || state.finished.includes(keyOf(meeting))
      ? state
      : { meetings: [...state.meetings, { ...meeting }] },
  )
}

/** 정리가 끝났거나 볼 수 없게 된 회의를 뺀다 */
export function untrackMeeting(meeting: TrackedMeeting): void {
  useMeetingTrackerStore.setState((state) =>
    state.meetings.some((item) => isSame(item, meeting))
      ? { meetings: state.meetings.filter((item) => !isSame(item, meeting)) }
      : state,
  )
}

/**
 * 추적을 끝낸다. 지켜보던 회의를 빼고 「끝냄」으로 적는다.
 * **이 호출이 끝냈을 때만 true** 다 — 완료 알림·캐시 무효화·이동은 true 일 때만 한다.
 * 재렌더·StrictMode 의 효과 두 번 실행·재발견이 같은 회의를 두 번 끝내지 못한다 (U4-5).
 */
export function finishMeeting(meeting: TrackedMeeting): boolean {
  const key = keyOf(meeting)
  if (useMeetingTrackerStore.getState().finished.includes(key)) return false
  useMeetingTrackerStore.setState((state) => ({
    meetings: state.meetings.filter((item) => !isSame(item, meeting)),
    finished: [...state.finished, key],
  }))
  return true
}

/** 로그아웃·세션 만료 때 모두 비운다 */
export function clearTrackedMeetings(): void {
  useMeetingTrackerStore.setState({ meetings: [], finished: [] })
}
