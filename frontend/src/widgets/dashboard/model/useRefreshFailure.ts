import { useCallback, useEffect, useRef } from 'react'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { toast } from '@/shared/ui/toast'
import { refreshFailure } from './useDashboardData'
import type { DashboardData, RefreshFailure } from './useDashboardData'

/** 갱신 실패 토스트의 key. 같은 key 는 하나로 합쳐진다 */
export const REFRESH_FAILED_TOAST_KEY = 'dashboard-refresh-failed'

export interface DashboardRefreshFailure extends RefreshFailure {
  /** 최신 상태를 받지 못한 영역. 화면 순서다 */
  areas: string[]
  /** `요약·최근 반영의 최신 상태를 받지 못했어요` */
  message: string
}

/**
 * 대시보드 전체의 갱신 실패를 하나로 묶는다 (E-02). 판정은 각 조회의 `refreshFailed`(`queryView`) 뿐이다.
 * 영역 이름은 어느 조회가 실패했는지로 정한다. 요약 = 태스크·승인 대기, 확인 필요 = 승인 대기(PM),
 * 최근 반영 = 태스크·회의 목록·회의 상세·추출·연동. 마감 임박과 그곳에만 쓰는 팀원 목록은 알리지 않는다
 */
export function dashboardRefreshFailure(
  data: DashboardData,
  isPm: boolean,
): DashboardRefreshFailure | undefined {
  const recent = [
    data.tasks,
    data.meetings,
    data.recent?.detail,
    data.recent?.extraction,
    data.integrations,
  ]
  const areas = [
    ['요약', refreshFailure(data.tasks, data.approvals)],
    ['확인 필요', isPm ? refreshFailure(data.approvals) : undefined],
    ['최근 반영', refreshFailure(...recent)],
  ] as const
  const failed = areas.flatMap(([name, failure]) => (failure === undefined ? [] : [name]))
  const all = refreshFailure(data.approvals, ...recent)
  if (all === undefined || failed.length === 0) return undefined
  return { ...all, areas: failed, message: `${failed.join('·')}의 최신 상태를 받지 못했어요` }
}

/**
 * 갱신 실패를 토스트로 한 번 알린다 (E-02). 실패가 없던 상태에서 생기는 순간 한 번이고, 실패가 이어지는 동안 반복하지 않는다.
 * 다시 시도(이 훅이 돌려준 `retry`)를 눌렀는데 또 실패하면 한 번 더, 회복한 뒤 다시 실패하면 다시 한 번 띄운다.
 * 다시 받는 중에는 띄우지 않는다 — 결과가 실패로 끝난 뒤에 판단한다. 남는 표시는 화면이 따로 그린다.
 * 토스트는 공통 저장소 규칙(표시 시간)을 따르므로 대시보드를 떠난 뒤에도 남은 시간 동안 보일 수 있다
 */
export function useRefreshFailureToast(
  failure: DashboardRefreshFailure | undefined,
): DashboardRefreshFailure | undefined {
  const announced = useRef(false)
  // 토스트의 다시 시도가 눌릴 때 쓸 지금의 묶음. 토스트는 띄운 뒤에도 남아 있어 그때의 조회를 다시 불러야 한다
  const latest = useRef(failure)
  const failed = failure !== undefined
  const retrying = failure?.retrying ?? false
  const message = failure?.message ?? null

  // 사용자가 다시 시도했다 — 이번 결과가 또 실패면 다시 알린다
  const retry = useCallback(() => {
    announced.current = false
    latest.current?.retry()
  }, [])

  useEffect(() => {
    latest.current = failure
  })

  useEffect(() => {
    if (!failed) {
      announced.current = false
      return
    }
    if (retrying || announced.current || message === null) return
    announced.current = true
    toast.show({
      key: REFRESH_FAILED_TOAST_KEY,
      title: message,
      action: { label: COMMON_MESSAGES.retry, onClick: retry },
    })
  }, [failed, retrying, message, retry])

  return failure === undefined ? undefined : { ...failure, retry }
}
