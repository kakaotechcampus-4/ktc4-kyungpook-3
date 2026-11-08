import { WRITE_UNCONFIRMED_MESSAGES } from '@/shared/api/errorMessages'
import { toast } from './toastStore'

/**
 * 쓰기 요청의 응답을 읽지 못했다(`INVALID_RESPONSE`). 서버에는 반영됐을 수 있어 실패라고 하지 않는다.
 * `새로고침` 은 페이지가 아니라 호출자가 정한 데이터를 다시 받는다 (#348)
 */
export function showWriteUnconfirmed(onRefresh: () => void): void {
  toast.show({
    key: 'write-unconfirmed',
    title: WRITE_UNCONFIRMED_MESSAGES.title,
    description: WRITE_UNCONFIRMED_MESSAGES.description,
    action: { label: WRITE_UNCONFIRMED_MESSAGES.refresh, onClick: onRefresh },
  })
}
