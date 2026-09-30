import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError } from '@/shared/api/errors'

/**
 * 제출 실패를 폼에 나눠 싣는다 (D-142).
 * 칸을 가리키는 코드는 그 칸의 오류로 `setError` 하고 포커스를 옮긴다 — 입력 아래에 뜬다.
 * 나머지(자격 증명·네트워크·서버 오류)는 비필드 오류라 문구를 돌려준다 — 폼 상단 FormErrorPanel 이 그린다.
 */
export function applyServerError<TValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TValues>,
  fieldByCode: Partial<Record<string, Path<TValues>>>,
): string | null {
  const field = error instanceof ApiError ? fieldByCode[error.code] : undefined
  if (field === undefined) return errorMessage(error)
  setError(field, { type: 'server', message: errorMessage(error) }, { shouldFocus: true })
  return null
}
