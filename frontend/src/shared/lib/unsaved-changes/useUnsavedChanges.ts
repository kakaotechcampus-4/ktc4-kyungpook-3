import { useCallback, useEffect, useId } from 'react'
import { useUnsavedChangesStore } from './store'

export interface UnsavedChangesHandle {
  /** 저장 성공 직후 같은 이벤트 안에서 이동할 때 부른다. 다음 렌더를 기다리지 않고 등록을 푼다 */
  release: () => void
}

/**
 * 저장하지 않은 변경이 있는 동안 이 화면을 등록한다 (D-138). 모달은 앱에 하나뿐이고 여기서 그리지 않는다.
 * 저장·초기화·업로드 시작으로 `isDirty` 가 false 가 되면 등록이 풀리고 더 묻지 않는다.
 */
export function useUnsavedChanges(isDirty: boolean): UnsavedChangesHandle {
  const id = useId()
  const mark = useUnsavedChangesStore((state) => state.mark)
  const unmark = useUnsavedChangesStore((state) => state.unmark)

  useEffect(() => {
    if (!isDirty) return
    mark(id)
    return () => unmark(id)
  }, [id, isDirty, mark, unmark])

  const release = useCallback(() => unmark(id), [id, unmark])
  return { release }
}
