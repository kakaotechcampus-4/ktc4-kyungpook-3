import { create } from 'zustand'

interface UnsavedChangesState {
  /** 저장하지 않은 변경을 가진 곳의 id. 하나라도 있으면 이동을 묻는다 */
  sources: ReadonlySet<string>
  /** 모달이 묻는 동안 저장해 둔 이동. 이 값이 있으면 모달이 열린다 */
  pendingLeave: (() => void) | null
  mark: (id: string) => void
  unmark: (id: string) => void
  reset: () => void
}

/* 서버 데이터가 아니라 화면 상태라서 Zustand 에 둔다 (D-110). persist 하지 않는다 (D-147). */
export const useUnsavedChangesStore = create<UnsavedChangesState>()((set) => ({
  sources: new Set<string>(),
  pendingLeave: null,
  mark: (id) =>
    set((state) => (state.sources.has(id) ? state : { sources: new Set(state.sources).add(id) })),
  unmark: (id) =>
    set((state) => {
      if (!state.sources.has(id)) return state
      const sources = new Set(state.sources)
      sources.delete(id)
      return { sources }
    }),
  reset: () => set({ sources: new Set<string>(), pendingLeave: null }),
}))

/** 이동 직전에 읽는다. 렌더 시점 값이 아니라 지금 값이다 */
export function hasUnsavedChanges(): boolean {
  return useUnsavedChangesStore.getState().sources.size > 0
}

/** 이탈 확인이 열려 있다 — 사용자가 다른 곳으로 가려다 고르는 중이다. 비동기로 끝난 일이 그 사이에 끼어들지 않는다 */
export function hasPendingLeave(): boolean {
  return useUnsavedChangesStore.getState().pendingLeave !== null
}

/** 세션 만료처럼 변경을 지킬 수 없는 이동 직전에 모든 등록과 저장해 둔 이동을 푼다 */
export function clearUnsavedChanges(): void {
  useUnsavedChangesStore.getState().reset()
}

/**
 * 경로가 바뀌는 이동 하나를 관문에 넣는다. 변경이 없으면 바로 실행한다.
 * 변경이 있으면 실행하지 않고 저장해 둔다 — 모달이 열리고 사용자가 고른다.
 * 이동 관문은 GuardedLink·useGuardedNavigate·useBrowserLeaveGuard 셋이다. 그 밖에는 화면을 떠나는
 * 동작(로그아웃, features/auth 의 useLogout)만 이 함수로 먼저 묻는다.
 */
export function guardLeave(leave: () => void): void {
  if (hasUnsavedChanges()) useUnsavedChangesStore.setState({ pendingLeave: leave })
  else leave()
}

/** `변경 내용 버리고 나가기`. 저장해 둔 이동을 한 번만 실행한다 */
export function confirmLeave(): void {
  const { pendingLeave } = useUnsavedChangesStore.getState()
  useUnsavedChangesStore.setState({ pendingLeave: null })
  pendingLeave?.()
}

/** `계속 작성하기`·Esc·배경 클릭. 저장해 둔 이동을 버린다 */
export function cancelLeave(): void {
  useUnsavedChangesStore.setState({ pendingLeave: null })
}
